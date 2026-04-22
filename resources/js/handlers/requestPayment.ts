/* eslint-disable @typescript-eslint/no-explicit-any */

interface PgPaymentData {
    order_number: string;
    order_name: string;
    amount: number;
    currency?: string;
    customer_name?: string;
    customer_email?: string;
    customer_phone?: string;
}

interface RequestPaymentParams {
    pgPaymentData: PgPaymentData;
}

interface ClientConfig {
    client_id: string;
    sdk_url: string;
    callback_urls: {
        callback: string;
    };
}

declare global {
    interface Window {
        AUTHNICE: any;
    }
}

function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });
}

/**
 * 나이스페이먼츠 결제창 호출 핸들러
 *
 * 체크아웃 레이아웃에서 주문 생성 API 성공 후 호출됩니다:
 *   handler: "sirsoft-pay-nicepayments.requestPayment"
 *   params: { pgPaymentData: response.data.pg_payment_data }
 *
 * 호출 순서:
 *   1. Client Config API 호출 → MID(client_id) 획득
 *   2. PAYNICE SDK 동적 로드 (미로드 시)
 *   3. PAYNICE.requestPay() 호출 → 결제창 오픈
 *   4. 결제 완료 시 나이스페이먼츠가 returnUrl(POST)로 인증값 전달
 */
export async function requestPaymentHandler(action: any, _context?: any): Promise<void> {
    const { pgPaymentData } = (action.params || {}) as RequestPaymentParams;

    if (!pgPaymentData) {
        console.error('[sirsoft-pay-nicepayments] pgPaymentData is required');
        return;
    }

    const G7Core = (window as any).G7Core;

    try {
        // 1. Client Config API 호출
        const configJson = await G7Core.api.get('/modules/sirsoft-ecommerce/payments/client-config/nicepayments');

        if (!configJson.data) {
            console.error('[sirsoft-pay-nicepayments] Failed to fetch client config', configJson);
            return;
        }

        const config: ClientConfig = configJson.data;

        // 2. AUTHNICE SDK 동적 로드
        if (!window.AUTHNICE) {
            await loadScript(config.sdk_url);
        }

        if (!window.AUTHNICE) {
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }

        if (!window.AUTHNICE) {
            const isHttp = window.location.protocol === 'http:';
            const msg = isHttp
                ? '나이스페이먼츠 결제창은 HTTPS 환경에서만 동작합니다.'
                : '나이스페이먼츠 SDK를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.';
            G7Core?.toast?.error?.(msg);
            G7Core?.state?.setLocal?.({ isSubmittingOrder: false });
            console.error('[sirsoft-pay-nicepayments] AUTHNICE SDK not available', { isHttp });
            return;
        }

        // 3. 결제 요청
        const callbackUrl = window.location.origin + config.callback_urls.callback;

        window.AUTHNICE.requestPay({
            clientId: config.client_id,
            method: 'card',
            orderId: pgPaymentData.order_number,
            amount: pgPaymentData.amount,
            goodsName: pgPaymentData.order_name,
            buyerName: pgPaymentData.customer_name ?? '',
            buyerEmail: pgPaymentData.customer_email ?? '',
            buyerTel: pgPaymentData.customer_phone ?? '',
            returnUrl: callbackUrl,
        });
        // → 나이스페이먼츠가 returnUrl로 POST 전송 (브라우저 리다이렉트 없이 폼 서브밋)

    } catch (error: unknown) {
        console.error('[sirsoft-pay-nicepayments] requestPayment error', error);
        G7Core?.state?.setLocal?.({ isSubmittingOrder: false });
        G7Core?.toast?.error?.('결제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    }
}
