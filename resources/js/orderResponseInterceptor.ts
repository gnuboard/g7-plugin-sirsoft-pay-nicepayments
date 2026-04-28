/**
 * 주문 생성 API 요청/응답 인터셉터
 *
 * 체크아웃 템플릿(_checkout_summary.json:464-485)에는 'sirsoft-tosspayments' 분기만
 * 정의되어 있어서, 'sirsoft-nicepayments' PG는 navigate 기본 분기로 떨어져
 * /shop/orders/{order_number}/complete 로 이동해버림 (결제창 미노출).
 *
 * 추가로, 간편결제(nicepay_kakaopay 등)는 서버의 PaymentMethodEnum에 없으므로
 * 요청 전에 payment_method 를 'card' 로 교체하고, 원래 nicepay 방식은 별도 보관한다.
 *
 * 코어/템플릿 수정 없이 이 문제를 우회하기 위해 plugin loading.strategy=global 시점에
 * window.fetch를 래핑해 다음을 수행:
 *
 *   1. POST /api/modules/sirsoft-ecommerce/user/orders 요청을 가로챈다
 *   2. payment_method 가 'nicepay_*' 이면 'card' 로 교체해 서버에 전송
 *   3. 응답에서 pg_provider === 'sirsoft-nicepayments' 이면 requestPayment 핸들러를 직접 호출
 *   4. 원래 nicepay 방식(paymentMethod)을 requestPayment 에 전달해 올바른 결제창 호출
 *   5. redirect_url 을 현재 URL로 교체 → 템플릿 fallback navigate 가 no-op 됨
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
 */
function extractPaymentMethodFromRequest(init?: RequestInit): string | undefined {
    if (init?.body === undefined || init.body === null) return undefined;

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

    return undefined;
}

/**
 * RequestInit 의 body 에서 payment_method 를 newMethod 로 교체한 새 RequestInit 반환
 */
function replacePaymentMethodInInit(init: RequestInit, newMethod: string): RequestInit {
    if (!init.body) return init;

    if (typeof init.body === 'string') {
        try {
            const parsed = JSON.parse(init.body) as Record<string, unknown>;
            if (typeof parsed.payment_method === 'string') {
                return { ...init, body: JSON.stringify({ ...parsed, payment_method: newMethod }) };
            }
        } catch {
            /* fall through */
        }
    } else if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
        const fd = new FormData();
        for (const [key, value] of init.body.entries()) {
            fd.append(key, key === 'payment_method' ? newMethod : value);
        }
        return { ...init, body: fd };
    } else if (typeof URLSearchParams !== 'undefined' && init.body instanceof URLSearchParams) {
        const sp = new URLSearchParams(init.body.toString());
        sp.set('payment_method', newMethod);
        return { ...init, body: sp };
    }

    return init;
}

function isTargetEndpoint(url: string, method: string): boolean {
    if (method !== 'POST') return false;
    const path = url.split('?')[0].split('#')[0];
    return path === ORDER_CREATE_PATH || path.endsWith(ORDER_CREATE_PATH);
}

function buildNoOpRedirectUrl(): string {
    return window.location.pathname + window.location.search + window.location.hash;
}

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
        const url = extractUrl(input);
        const method = extractMethod(input, init);

        // 타겟 엔드포인트가 아닌 경우 바로 통과
        if (!isTargetEndpoint(url, method)) {
            return originalFetch(input, init);
        }

        // 간편결제(nicepay_*) 여부 확인 — 서버 전송 전에 'card' 로 교체
        const originalPaymentMethod = extractPaymentMethodFromRequest(init);
        const isEasyPay = typeof originalPaymentMethod === 'string' && originalPaymentMethod.startsWith('nicepay_');

        let effectiveInit = init;
        if (isEasyPay && init) {
            effectiveInit = replacePaymentMethodInInit(init, 'card');
            logger.info(`easy pay detected: replacing payment_method '${originalPaymentMethod}' → 'card' for server request`);
        }

        const response = await originalFetch(input, effectiveInit);

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

        // 결제수단 결정 우선순위:
        //   1. _local.paymentMethod (nicepay_* 간편결제 — 템플릿이 serverPaymentMethod='card' 로 교체해도 원본 보존)
        //   2. 요청 본문에서 추출한 originalPaymentMethod (easy pay 인 경우)
        //   3. 요청 본문의 현재 payment_method (일반 결제)
        const localPaymentMethod = (window as unknown as Record<string, unknown>).__templateApp;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const localState = (localPaymentMethod as any)?.globalState?._local;
        const localNicepayMethod: string | undefined =
            typeof localState?.paymentMethod === 'string' && localState.paymentMethod.startsWith('nicepay_')
                ? localState.paymentMethod
                : undefined;

        const paymentMethod = localNicepayMethod ?? (isEasyPay ? originalPaymentMethod : extractPaymentMethodFromRequest(init));

        logger.info('intercepted order create response — opening PG popup', { paymentMethod });

        void requestPaymentHandler({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            params: { pgPaymentData: pgPaymentData as any, paymentMethod },
        });

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
