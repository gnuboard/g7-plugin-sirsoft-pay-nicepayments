/* eslint-disable @typescript-eslint/no-explicit-any */

export function setPaymentMethodHandler(action: any): void {
    const paymentMethod = action.params?.paymentMethod;
    if (!paymentMethod) return;

    (window as any).G7Core?.state?.setLocal?.({ paymentMethod });
}
