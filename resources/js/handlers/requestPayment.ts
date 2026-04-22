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
    mid: string;
    sdk_url: string;
    callback_url: string;
    sign_data_url: string;
}

interface SignDataResponse {
    ediDate: string;
    signData: string;
    mid: string;
}

declare global {
    interface Window {
        nicepaySubmit: () => void;
        nicepayClose: (resultCode: string, resultMsg: string) => void;
        goPay: (form: HTMLFormElement) => void;
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
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });
}

function isMobileDevice(): boolean {
    return /Mobile|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function createPaymentForm(action: string, fields: Record<string, string>): HTMLFormElement {
    const form = document.createElement('form');
    form.id = 'nicepayForm';
    form.method = 'post';
    form.action = action;

    for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
    }

    document.body.appendChild(form);
    return form;
}

/**
 * 나이스페이먼츠 결제창 호출 핸들러 (나이스페이 구형 API, goPay 방식)
 *
 * 체크아웃 레이아웃에서 주문 생성 API 성공 후 호출됩니다:
 *   handler: "sirsoft-pay-nicepayments.requestPayment"
 *   params: { pgPaymentData: response.data.pg_payment_data }
 *
 * 호출 순서:
 *   1. Client Config API 호출 → MID, SDK URL, SignData URL 획득
 *   2. nicepay-pgweb.js SDK 동적 로드
 *   3. 서버에서 EdiDate + SignData 생성
 *   4. 결제 폼 생성 후 goPay(form) 호출 (PC) / 직접 폼 제출 (모바일)
 *   5. 결제 완료 시 나이스페이먼츠가 ReturnURL(POST)로 인증값 전달
 */
export async function requestPaymentHandler(action: any, _context?: any): Promise<void> {
    const { pgPaymentData } = (action.params || {}) as RequestPaymentParams;

    if (!pgPaymentData) {
        console.error('[sirsoft-pay-nicepayments] pgPaymentData is required');
        return;
    }

    const G7Core = (window as any).G7Core;

    try {
        // 1. Client Config 가져오기
        const configJson = await G7Core.api.get('/modules/sirsoft-ecommerce/payments/client-config/nicepayments');

        if (!configJson.data) {
            console.error('[sirsoft-pay-nicepayments] Failed to fetch client config', configJson);
            return;
        }

        const config: ClientConfig = configJson.data;

        // 2. nicepay-pgweb.js SDK 동적 로드
        await loadScript(config.sdk_url);

        if (typeof window.goPay !== 'function') {
            G7Core?.toast?.error?.('나이스페이먼츠 SDK를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.');
            G7Core?.state?.setLocal?.({ isSubmittingOrder: false });
            return;
        }

        // 3. 서버에서 EdiDate + SignData 생성
        const signDataUrl = window.location.origin + config.sign_data_url;
        const signDataRes = await fetch(signDataUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body: JSON.stringify({ amt: pgPaymentData.amount, moid: pgPaymentData.order_number }),
        });

        if (!signDataRes.ok) {
            throw new Error('SignData 생성에 실패했습니다.');
        }

        const signData: SignDataResponse = await signDataRes.json();
        const callbackUrl = window.location.origin + config.callback_url;

        // 4. 결제 폼 생성
        const form = createPaymentForm(callbackUrl, {
            PayMethod: 'CARD',
            GoodsName: pgPaymentData.order_name,
            Amt: String(pgPaymentData.amount),
            MID: signData.mid,
            Moid: pgPaymentData.order_number,
            BuyerName: pgPaymentData.customer_name ?? '',
            BuyerEmail: pgPaymentData.customer_email ?? '',
            BuyerTel: pgPaymentData.customer_phone ?? '',
            ReturnURL: callbackUrl,
            EdiDate: signData.ediDate,
            SignData: signData.signData,
            CharSet: 'utf-8',
        });

        // 5. 나이스페이 전역 콜백 정의
        window.nicepaySubmit = () => {
            form.submit();
        };

        window.nicepayClose = (_resultCode: string, resultMsg: string) => {
            if (form.parentNode) {
                form.parentNode.removeChild(form);
            }
            G7Core?.state?.setLocal?.({ isSubmittingOrder: false });
            if (resultMsg) {
                G7Core?.toast?.error?.(resultMsg);
            }
        };

        // 6. 결제창 호출 (모바일: 직접 제출 / PC: 팝업)
        if (isMobileDevice()) {
            form.action = 'https://web.nicepay.co.kr/v3/v3Payment.jsp';
            form.submit();
        } else {
            window.goPay(form);
        }

    } catch (error: unknown) {
        console.error('[sirsoft-pay-nicepayments] requestPayment error', error);
        G7Core?.state?.setLocal?.({ isSubmittingOrder: false });
        G7Core?.toast?.error?.('결제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    }
}
