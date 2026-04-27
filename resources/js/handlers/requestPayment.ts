interface G7ApiResponse {
    data?: unknown;
}

interface G7CoreApi {
    get: (url: string) => Promise<G7ApiResponse>;
}

interface G7CoreToast {
    error: (message: string) => void;
}

interface G7CoreStateApi {
    setLocal: (state: Record<string, unknown>) => void;
}

interface G7Core {
    api: G7CoreApi;
    toast?: G7CoreToast;
    state?: G7CoreStateApi;
}

interface TemplateLocalState {
    paymentMethod?: string;
}

interface TemplateApp {
    globalState?: {
        _local?: TemplateLocalState;
    };
}

interface PgPaymentData {
    order_number: string;
    order_name: string;
    amount: number;
    currency?: string;
    customer_name?: string;
    customer_email?: string;
    customer_phone?: string;
    goods_cl?: string; // 휴대폰결제 상품 유형: '0'=디지털컨텐츠, '1'=실물
}

interface RequestPaymentParams {
    pgPaymentData: PgPaymentData;
    paymentMethod?: string;
}

interface ClientConfig {
    mid: string;
    sdk_url: string;
    sign_data_url: string;
    useEscrow?: boolean;
}

interface SignDataResponse {
    ediDate: string;
    signData: string;
    mid: string;
}

interface PaymentAction {
    params?: RequestPaymentParams;
}

declare global {
    interface Window {
        nicepaySubmit: () => void;
        nicepayClose: (resultCode: string, resultMsg: string) => void;
        goPay: (form: HTMLFormElement) => void;
        G7Core: G7Core;
        __templateApp?: TemplateApp;
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

function createPaymentForm(action: string, fields: Record<string, string>): HTMLFormElement {
    const form = document.createElement('form');
    form.id = 'nicepayForm';
    form.method = 'post';
    form.action = action;
    // CharSet 필드와 일치 — 모바일은 form.acceptCharset 으로 charset 결정
    form.acceptCharset = 'utf-8';

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

const CALLBACK_PATH = '/plugins/sirsoft-pay-nicepayments/payment/callback';

// 나이스페이 v3 모바일 결제창 endpoint — 폼을 직접 POST 하면 NicePay 모바일 페이지로 전체 redirect.
// PC 와 달리 SDK 불필요. 결제 완료 후 ReturnURL 로 redirect.
const NICEPAY_MOBILE_ENDPOINT = 'https://web.nicepay.co.kr/v3/v3Payment.jsp';

/**
 * 모바일 환경 판별.
 *
 * NicePay 의 PC SDK (`goPay`) 는 모바일 자동 감지를 하지 않으므로
 * UA 기반 분기가 필요. iOS/Android/Windows Phone 및 주요 in-app 브라우저 (KakaoTalk
 * NaverApp, Line, Instagram 등) 모두 모바일로 처리.
 *
 * 한 가지 더 — 화면 크기 보조 검사: 일부 데스크탑 사용자가 모바일 시뮬레이션을
 * 켜는 경우와 일부 태블릿 UA 가 모호한 경우를 함께 처리.
 */
function isMobileDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = (navigator.userAgent || '').toLowerCase();

    // 명시적 모바일 UA
    const mobileUA = /android|iphone|ipad|ipod|windows phone|iemobile|blackberry|opera mini|mobile|kakaotalk|naver|line|instagram|fban|fbav/;
    if (mobileUA.test(ua)) return true;

    // 터치 + 좁은 화면 보조 검사 (iPadOS 가 데스크탑 UA 를 보내는 경우 등)
    const touchPoints = (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0;
    if (touchPoints > 1 && Math.min(window.innerWidth, window.innerHeight) <= 1024) {
        return true;
    }

    return false;
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
 *   2. 환경 분기: PC 면 SDK 동적 로드 / 모바일 은 SDK 생략
 *   3. 서버에서 EdiDate + SignData 생성
 *   4. 결제 폼 생성:
 *      - PC: 폼 action=ReturnURL → goPay(form) 으로 iframe 팝업
 *      - 모바일: 폼 action=https://web.nicepay.co.kr/v3/v3Payment.jsp → 직접 submit (전체 페이지 redirect)
 *   5. 결제 완료 시 나이스페이먼츠가 ReturnURL(POST)로 인증값 전달
 *
 * NicePay 의 PC SDK 는 모바일 자동 감지를 하지 않으므로 UA 기반 분기가 필수.
 * 잘못 분기하면 모바일에서도 PC 팝업이 떠 사용성이 매우 나빠짐.
 */
export async function requestPaymentHandler(action: PaymentAction, _context?: unknown): Promise<void> {
    const { pgPaymentData, paymentMethod: paramPaymentMethod } = action.params ?? {};

    const localState = window.__templateApp?.globalState?._local;
    const paymentMethod = paramPaymentMethod ?? localState?.paymentMethod ?? 'card';

    if (!pgPaymentData) {
        console.error('[sirsoft-pay-nicepayments] pgPaymentData is required');
        return;
    }

    const G7Core = window.G7Core;

    try {
        // 1. Client Config 가져오기
        const configJson = await G7Core.api.get('/modules/sirsoft-ecommerce/payments/client-config/nicepayments');

        if (!configJson.data) {
            console.error('[sirsoft-pay-nicepayments] Failed to fetch client config', configJson);
            return;
        }

        const config = configJson.data as ClientConfig;
        const isMobile = isMobileDevice();

        // 2. PC 인 경우에만 SDK 로드 (모바일 은 직접 form submit 으로 NicePay 모바일 페이지로 이동)
        if (!isMobile) {
            await loadScript(config.sdk_url);

            if (typeof window.goPay !== 'function') {
                G7Core?.toast?.error?.('나이스페이먼츠 SDK를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.');
                G7Core?.state?.setLocal?.({ isSubmittingOrder: false });
                return;
            }
        }

        // 3. 서버에서 EdiDate + SignData 생성
        //    sign-data 엔드포인트는 'auth' 미들웨어가 걸려있어 Sanctum Bearer 토큰
        //    또는 세션 쿠키 중 하나가 필요. SPA 모드에서 토큰만 있는 경우를 대비해
        //    localStorage 의 auth_token 을 Authorization 헤더로 명시 전달하고,
        //    credentials:include 로 세션 쿠키도 함께 전송 (둘 중 하나만 있어도 통과).
        const signDataUrl = window.location.origin + config.sign_data_url;
        const authToken = (typeof localStorage !== 'undefined') ? localStorage.getItem('auth_token') : null;
        const signDataHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json',
        };
        if (authToken) {
            signDataHeaders['Authorization'] = `Bearer ${authToken}`;
        }
        const signDataRes = await fetch(signDataUrl, {
            method: 'POST',
            credentials: 'include',
            headers: signDataHeaders,
            body: JSON.stringify({ amt: pgPaymentData.amount, moid: pgPaymentData.order_number }),
        });

        if (!signDataRes.ok) {
            throw new Error('SignData 생성에 실패했습니다.');
        }

        const signData: SignDataResponse = await signDataRes.json();
        const callbackUrl = window.location.origin + CALLBACK_PATH;

        // 4. 결제 폼 생성
        const payMethodMap: Record<string, string> = {
            card: 'CARD',
            vbank: 'VBANK',
            bank: 'BANK',
            phone: 'CELLPHONE',
        };
        const payMethod = payMethodMap[paymentMethod ?? 'card'] ?? 'CARD';

        const formFields: Record<string, string> = {
            PayMethod: payMethod,
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
        };

        // 휴대폰결제: 상품 유형 필수 (0:디지털컨텐츠, 1:실물)
        if (payMethod === 'CELLPHONE') {
            formFields.GoodsCl = pgPaymentData.goods_cl ?? '1';
        }

        // 에스크로 결제: 실물 상품 전용 (GoodsCl=1 필수)
        if (config.useEscrow) {
            formFields.EscrowYN = 'Y';
            formFields.GoodsCl = '1';
        }

        // 4-2. 과세/비과세 금액 조회 (optional — 실패해도 결제 진행)
        try {
            const orderRes = await G7Core.api.get(`/modules/sirsoft-ecommerce/user/orders/${pgPaymentData.order_number}`);
            const od = orderRes?.data as Record<string, unknown> | null | undefined;
            if (od) {
                const taxAmt = Number(od['total_tax_amount'] ?? 0);
                const vatAmt = Number(od['total_vat_amount'] ?? 0);
                const taxFreeAmt = Number(od['total_tax_free_amount'] ?? 0);
                if (taxAmt > 0 || vatAmt > 0 || taxFreeAmt > 0) {
                    formFields.TaxAmt = String(taxAmt);
                    formFields.VatAmt = String(vatAmt);
                    formFields.TaxFreeAmt = String(taxFreeAmt);
                }
            }
        } catch {
            // 과세 필드는 선택 사항 — 조회 실패 시 미포함 상태로 진행
        }

        const form = createPaymentForm(callbackUrl, formFields);

        if (isMobile) {
            // 모바일 결제창 호출:
            //   - form.action = NicePay 모바일 endpoint
            //   - acceptCharset = 'euc-kr' : NicePay v3 mobile 은 EUC-KR 로 form 데이터를 받음
            //     (NicePay 공식 샘플과 동일). 브라우저가 자동으로 UTF-8 → EUC-KR 변환.
            //   - CharSet 입력값도 'euc-kr' 로 일치 — NicePay 가 같은 인코딩으로 디코딩하도록.
            //     (utf-8 그대로 두면 GoodsName/BuyerName 한글이 mojibake "遺?瑜?" 로 깨짐)
            //   결제 완료 후 NicePay 가 ReturnURL 로 redirect.
            form.action = NICEPAY_MOBILE_ENDPOINT;
            form.acceptCharset = 'euc-kr';
            const charsetInput = form.querySelector('input[name="CharSet"]') as HTMLInputElement | null;
            if (charsetInput) {
                charsetInput.value = 'euc-kr';
            }
            form.submit();
            // 페이지 자체가 redirect 되므로 정리 로직 불필요. submit 후 이 함수의 후속 코드는 실행되지 않음.
            return;
        }

        // 이하 PC 전용 — iframe 팝업 + nicepaySubmit / nicepayClose 콜백 처리

        // 5. 나이스페이 전역 콜백 정의
        window.nicepaySubmit = () => {
            form.submit();
        };

        let paymentClosed = false;

        // goPay() 전 body 자식 스냅샷 — SDK가 추가하는 오버레이/iframe 식별용
        const bodySnapshot = new Set(document.body.children);

        const closePayment = (_resultCode: string, resultMsg: string) => {
            if (paymentClosed) return;
            paymentClosed = true;
            window.removeEventListener('popstate', handlePopState);
            // SDK가 body에 추가한 오버레이/iframe 등 제거
            Array.from(document.body.children).forEach(el => {
                if (!bodySnapshot.has(el)) el.remove();
            });
            if (form.parentNode) form.parentNode.removeChild(form);
            G7Core?.state?.setLocal?.({ isSubmittingOrder: false });
            if (resultMsg) G7Core?.toast?.error?.(resultMsg);
        };

        window.nicepayClose = closePayment;

        // 뒤로가기(popstate) 감지 → 결제창 정리
        const handlePopState = () => closePayment('', '');

        // 결제창 열기 전 history state 추가 → 뒤로가기 시 popstate 발생
        window.history.pushState({ nicepayOpen: true }, '');
        window.addEventListener('popstate', handlePopState);

        // 6. PC 결제창 호출 (iframe 팝업)
        window.goPay(form);

    } catch (error: unknown) {
        console.error('[sirsoft-pay-nicepayments] requestPayment error', error);
        G7Core?.state?.setLocal?.({ isSubmittingOrder: false });
        G7Core?.toast?.error?.('결제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    }
}
