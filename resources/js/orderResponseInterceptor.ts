/**
 * 주문 생성 API 응답 인터셉터
 *
 * 체크아웃 템플릿(_checkout_summary.json:464-485)에는 'sirsoft-tosspayments' 분기만
 * 정의되어 있어서, 'sirsoft-nicepayments' PG는 navigate 기본 분기로 떨어져
 * /shop/orders/{order_number}/complete 로 이동해버림 (결제창 미노출).
 *
 * 코어/템플릿 수정 없이 이 문제를 우회하기 위해 plugin loading.strategy=global 시점에
 * window.fetch를 래핑해 다음을 수행:
 *
 *   1. POST /api/modules/sirsoft-ecommerce/user/orders 응답을 가로챈다
 *   2. data.pg_provider === 'sirsoft-nicepayments' 이면 requestPayment 핸들러를 직접 호출하여 결제창 띄움
 *   3. data.redirect_url 을 현재 URL로 교체하고 requires_pg_payment를 false로 변경
 *      → 템플릿 fallback 분기의 navigate 가 navigate-to-self 가 되어 실질적 이동 없음
 *
 * 결과: 체크아웃 페이지에 머문 채 PG 팝업이 뜨고, PG 콜백이 정식 complete 페이지로 redirect.
 */

import { requestPaymentHandler } from './handlers/requestPayment';

const ORDER_CREATE_PATH = '/api/modules/sirsoft-ecommerce/user/orders';
const TARGET_PG_PROVIDER = 'sirsoft-nicepayments';
const PLUGIN_IDENTIFIER = 'sirsoft-pay-nicepayments';

const logger = {
    info: (...args: unknown[]) => console.info(`[${PLUGIN_IDENTIFIER}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${PLUGIN_IDENTIFIER}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${PLUGIN_IDENTIFIER}]`, ...args),
};

interface OrderCreateResponseBody {
    success?: boolean;
    message?: string;
    data?: {
        order?: { order_number?: string };
        redirect_url?: string;
        requires_pg_payment?: boolean;
        pg_provider?: string;
        pg_payment_data?: Record<string, unknown>;
    };
}

function extractUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
    return String(input);
}

function extractMethod(input: RequestInfo | URL, init?: RequestInit): string {
    if (init?.method) return init.method.toUpperCase();
    if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
    return 'GET';
}

/**
 * 요청 본문에서 payment_method 필드를 추출
 *
 * `_local.paymentMethod` 상태에 의존하지 않고, 백엔드가 실제로 받은 값을
 * 그대로 사용함으로써 다음 케이스를 안전하게 처리:
 *   - 사용자가 결제수단 클릭 후 다른 액션으로 상태가 변경된 경우
 *   - SSR/Hydration 시점 차이로 _local.paymentMethod 가 undefined 인 경우
 *   - 다른 컴포넌트가 _local 을 동시 갱신하는 경우 (Windows/특정 브라우저 타이밍)
 *
 * @returns payment_method 값 ('card' | 'vbank' | 'bank' | 'phone' 등) 또는 undefined
 */
function extractPaymentMethodFromRequest(input: RequestInfo | URL, init?: RequestInit): string | undefined {
    // 1) init.body (string JSON 또는 FormData)
    if (init?.body !== undefined && init.body !== null) {
        if (typeof init.body === 'string') {
            try {
                const parsed = JSON.parse(init.body) as Record<string, unknown>;
                const v = parsed.payment_method;
                if (typeof v === 'string' && v.length > 0) return v;
            } catch {
                /* fall through */
            }
        } else if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
            const v = init.body.get('payment_method');
            if (typeof v === 'string' && v.length > 0) return v;
        } else if (typeof URLSearchParams !== 'undefined' && init.body instanceof URLSearchParams) {
            const v = init.body.get('payment_method');
            if (v && v.length > 0) return v;
        }
    }

    // 2) Request 객체 형태 (init 없이 fetch(new Request(...)) 호출 시)
    //    Request.body 는 ReadableStream 이라 동기 추출 불가 → init 우선 처리.
    //    이 경로에선 undefined 반환하고 호출 측이 fallback (handler 내부의 _local) 처리.
    void input;

    return undefined;
}

function isTargetEndpoint(url: string, method: string): boolean {
    if (method !== 'POST') return false;
    // 쿼리스트링/해시 제거 후 경로만 비교
    const path = url.split('?')[0].split('#')[0];
    return path === ORDER_CREATE_PATH || path.endsWith(ORDER_CREATE_PATH);
}

function buildNoOpRedirectUrl(): string {
    // 현재 페이지 URL — navigate-to-self 는 React Router에서 사실상 no-op
    return window.location.pathname + window.location.search + window.location.hash;
}

/**
 * 응답 본문을 mutate한 새 Response 객체 생성
 *
 * 원본 Response 의 status/headers 는 보존하고 본문만 재구성.
 */
function mutateResponse(originalResponse: Response, mutatedBody: OrderCreateResponseBody): Response {
    const json = JSON.stringify(mutatedBody);
    return new Response(json, {
        status: originalResponse.status,
        statusText: originalResponse.statusText,
        headers: originalResponse.headers,
    });
}

export function installOrderResponseInterceptor(): void {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
        return;
    }

    // 중복 설치 방지 — HMR / 다중 IIFE 로드 시
    const flag = '__sirsoftNicepayInterceptorInstalled' as const;
    const w = window as unknown as Record<string, unknown>;
    if (w[flag]) {
        return;
    }
    w[flag] = true;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async function patchedFetch(
        input: RequestInfo | URL,
        init?: RequestInit
    ): Promise<Response> {
        const response = await originalFetch(input, init);

        const url = extractUrl(input);
        const method = extractMethod(input, init);

        if (!isTargetEndpoint(url, method)) {
            return response;
        }

        // 본문은 한 번만 읽을 수 있으므로 클론
        let cloned: Response;
        try {
            cloned = response.clone();
        } catch {
            return response;
        }

        let body: OrderCreateResponseBody | null = null;
        try {
            body = (await cloned.json()) as OrderCreateResponseBody;
        } catch {
            // 비-JSON 응답이면 그대로 통과
            return response;
        }

        const data = body?.data;
        if (!data) return response;

        const requiresPg = data.requires_pg_payment === true;
        const isNicepay = data.pg_provider === TARGET_PG_PROVIDER;

        if (!requiresPg || !isNicepay) {
            return response;
        }

        const pgPaymentData = data.pg_payment_data;
        if (!pgPaymentData) {
            logger.warn('nicepayments order detected but pg_payment_data missing');
            return response;
        }

        // 결제수단을 요청 본문에서 추출 (백엔드가 받은 값과 동일 보장)
        const paymentMethod = extractPaymentMethodFromRequest(input, init);

        logger.info('intercepted order create response — opening PG popup', { paymentMethod });

        // 1) 결제창 호출 (비동기 — 팝업이 뜨도록 fire-and-forget)
        //    실패 시 requestPaymentHandler 내부에서 isSubmittingOrder=false 처리됨
        void requestPaymentHandler({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            params: { pgPaymentData: pgPaymentData as any, paymentMethod },
        });

        // 2) 응답 mutate — 템플릿의 navigate fallback 을 무력화
        //    - requires_pg_payment: false  (혹시 다른 곳에서 참조해도 안전)
        //    - redirect_url: 현재 URL       (navigate-to-self → 실질적 이동 없음)
        const mutatedBody: OrderCreateResponseBody = {
            ...body,
            data: {
                ...data,
                requires_pg_payment: false,
                redirect_url: buildNoOpRedirectUrl(),
            },
        };

        return mutateResponse(response, mutatedBody);
    };

    logger.info('order response interceptor installed');
}
