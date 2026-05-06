/**
 * 주문 생성 API 요청/응답 인터셉터
 *
 * G7Core 템플릿 엔진의 apiCall 핸들러는 window.fetch 를 직접 사용하므로
 * window.fetch 를 래핑하는 방식으로 동작한다.
 *
 *   1. POST /api/modules/sirsoft-ecommerce/user/orders 요청을 가로챈다
 *   2. payment_method 가 'nicepay_*' 이면 'card' 로 교체해 서버에 전송
 *      (서버의 PaymentMethodEnum 에 nicepay_* 가 없어서 422 발생 방지)
 *   3. 응답에서 pg_provider === 'sirsoft-nicepayments' 이면 requestPayment 핸들러를 직접 호출
 *   4. 원래 nicepay 방식(paymentMethod)을 requestPayment 에 전달해 올바른 결제창 호출
 *   5. requires_pg_payment → false, redirect_url → 현재 URL 로 교체
 *      → 템플릿 조건 분기가 !requires_pg_payment 쪽으로 떨어져 navigate-to-self 가 됨
 */

import { requestPaymentHandler } from './handlers/requestPayment';

const ORDER_CREATE_PATH = '/user/orders';
const TARGET_PG_PROVIDER = 'sirsoft-nicepayments';
const PLUGIN_IDENTIFIER = 'sirsoft-pay-nicepayments';
const FETCH_FLAG = '__sirsoftNicepayFetchInterceptorInstalled';

const logger = {
    info: (...args: unknown[]) => console.info(`[${PLUGIN_IDENTIFIER}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${PLUGIN_IDENTIFIER}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${PLUGIN_IDENTIFIER}]`, ...args),
};

function buildNoOpRedirectUrl(): string {
    return window.location.pathname + window.location.search + window.location.hash;
}

function isTargetOrderEndpoint(url: string, method: string): boolean {
    if (method.toUpperCase() !== 'POST') return false;
    const path = (url ?? '').split('?')[0].split('#')[0];
    return path === ORDER_CREATE_PATH || path.endsWith(ORDER_CREATE_PATH);
}

function extractPaymentMethodFromBody(body: unknown): string | undefined {
    if (!body) return undefined;
    let obj: Record<string, unknown> | null = null;
    if (typeof body === 'string') {
        try { obj = JSON.parse(body) as Record<string, unknown>; } catch { return undefined; }
    } else if (typeof body === 'object') {
        obj = body as Record<string, unknown>;
    }
    if (!obj) return undefined;
    const v = obj['payment_method'];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function replacePaymentMethodInBody(body: string, newMethod: string): string {
    try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        if ('payment_method' in parsed) {
            return JSON.stringify({ ...parsed, payment_method: newMethod });
        }
    } catch { /* fall through */ }
    return body;
}

export function installOrderResponseInterceptor(): void {
    const w = window as unknown as Record<string, unknown>;
    if (w[FETCH_FLAG]) return;
    w[FETCH_FLAG] = true;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
            typeof input === 'string'
                ? input
                : input instanceof URL
                    ? input.href
                    : (input as Request).url;
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');

        if (!isTargetOrderEndpoint(url, method)) {
            return originalFetch(input, init);
        }

        // 요청 body에서 nicepay_* → card 교체
        let originalPaymentMethod: string | undefined;
        let modifiedInit = init;

        if (init?.body && typeof init.body === 'string') {
            const pm = extractPaymentMethodFromBody(init.body);
            if (typeof pm === 'string' && pm.startsWith('nicepay_')) {
                originalPaymentMethod = pm;
                modifiedInit = { ...init, body: replacePaymentMethodInBody(init.body, 'card') };
                logger.info(`easy pay detected: replacing payment_method '${pm}' → 'card'`);
            }
        }

        const response = await originalFetch(input, modifiedInit);

        // 응답 파싱 (clone으로 원본 스트림 보호)
        // 서버 응답 구조: { success, message, data: { order, requires_pg_payment, pg_provider, pg_payment_data, redirect_url } }
        let envelope: Record<string, unknown> | null = null;
        try {
            envelope = (await response.clone().json()) as Record<string, unknown>;
        } catch {
            return response;
        }

        const responseData = (envelope?.data ?? envelope) as Record<string, unknown> | null;

        if (!responseData?.requires_pg_payment || responseData.pg_provider !== TARGET_PG_PROVIDER) {
            return response;
        }

        const pgPaymentData = responseData.pg_payment_data as Record<string, unknown> | undefined;
        if (!pgPaymentData) {
            logger.warn('nicepayments order detected but pg_payment_data missing');
            return response;
        }

        // 결제수단 결정: 요청에서 저장한 원본 > SPA _local 상태 > 기본 'card'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const localPaymentMethod = ((window as any).__templateApp)?.globalState?._local?.paymentMethod as string | undefined;
        const localNicepayMethod =
            typeof localPaymentMethod === 'string' && localPaymentMethod.startsWith('nicepay_')
                ? localPaymentMethod
                : undefined;

        const paymentMethod = originalPaymentMethod ?? localNicepayMethod ?? 'card';

        logger.info('intercepted order create response — opening PG popup', { paymentMethod });

        void requestPaymentHandler({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            params: { pgPaymentData: pgPaymentData as any, paymentMethod },
        });

        // envelope.data 안에 있는 경우와 최상위에 있는 경우 모두 처리
        const modifiedData = { ...responseData, requires_pg_payment: false, redirect_url: buildNoOpRedirectUrl() };
        const modifiedBody = envelope?.data
            ? { ...envelope, data: modifiedData }
            : modifiedData;

        return new Response(JSON.stringify(modifiedBody), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    };

    logger.info('fetch order interceptor installed');
}

/** @deprecated Axios 인터셉터 방식 — apiCall 핸들러가 window.fetch 를 사용하므로 동작하지 않음. installOrderResponseInterceptor 를 사용할 것. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installAxiosOrderInterceptor(_axiosClient: any): void {
    // no-op
}
