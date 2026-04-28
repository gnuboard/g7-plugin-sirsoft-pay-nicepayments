/* eslint-disable @typescript-eslint/no-explicit-any */

const METHOD_TO_TEXT: Record<string, string> = {
    nicepay_naverpay:   '네이버페이',
    nicepay_kakaopay:   '카카오페이',
    nicepay_samsungpay: '삼성페이',
    nicepay_applepay:   '애플페이',
    nicepay_payco:      'PAYCO',
    nicepay_skpay:      '11pay',
    nicepay_ssgpay:     'SSG페이',
    nicepay_lpay:       'L.pay',
};

// ring-white: 버튼 배경색과 무관하게 항상 눈에 띄는 흰색 테두리
const RING_MAP: Record<string, string[]> = {
    nicepay_naverpay:   ['ring-2', 'ring-offset-2', 'ring-white', 'shadow-lg'],
    nicepay_kakaopay:   ['ring-2', 'ring-offset-2', 'ring-white', 'shadow-lg'],
    nicepay_samsungpay: ['ring-2', 'ring-offset-2', 'ring-white', 'shadow-lg'],
    nicepay_applepay:   ['ring-2', 'ring-offset-2', 'ring-white', 'shadow-lg'],
    nicepay_payco:      ['ring-2', 'ring-offset-2', 'ring-white', 'shadow-lg'],
    nicepay_skpay:      ['ring-2', 'ring-offset-2', 'ring-white', 'shadow-lg'],
    nicepay_ssgpay:     ['ring-2', 'ring-offset-2', 'ring-white', 'shadow-lg'],
    nicepay_lpay:       ['ring-2', 'ring-offset-2', 'ring-white', 'shadow-lg'],
};

const ALL_RING_CLASSES = [...new Set(Object.values(RING_MAP).flat())];

function getEasyPayButtonContainer(): Element | null {
    // Extension이 #nicepay_checkout_payment_section 안에 주입됨
    // "간편결제" 텍스트 단락 다음 형제 div가 버튼 컨테이너
    const section = document.getElementById('nicepay_checkout_payment_section');
    if (!section) return null;
    const paras = section.querySelectorAll('p');
    for (const p of paras) {
        if (p.textContent?.includes('간편결제')) {
            return p.nextElementSibling;
        }
    }
    return null;
}

function updateEasyPayButtonStyles(selectedMethod: string): void {
    const container = getEasyPayButtonContainer();
    if (!container) return;

    const selectedText = METHOD_TO_TEXT[selectedMethod];
    container.querySelectorAll<HTMLButtonElement>('button').forEach(btn => {
        ALL_RING_CLASSES.forEach(cls => btn.classList.remove(cls));
        if (btn.textContent?.trim() === selectedText) {
            (RING_MAP[selectedMethod] ?? []).forEach(cls => btn.classList.add(cls));
        }
    });
}

export function setPaymentMethodHandler(action: any): void {
    const paymentMethod = action.params?.paymentMethod;
    if (!paymentMethod) return;

    const isEasyPay = typeof paymentMethod === 'string' && paymentMethod.indexOf('nicepay_') === 0;
    (window as any).G7Core?.state?.setLocal?.({
        paymentMethod,
        serverPaymentMethod: isEasyPay ? 'card' : paymentMethod,
    });

    // Extension 컴포넌트는 React 반응형 렌더링 밖에 있으므로 DOM 직접 업데이트
    if (isEasyPay) {
        updateEasyPayButtonStyles(paymentMethod);
    }
}
