<?php

declare(strict_types=1);

namespace Plugins\Sirsoft\Pay\Nicepayments\Listeners;

use App\Contracts\Extension\HookListenerInterface;
use App\Extension\HookManager;
use Illuminate\Support\Facades\Log;
use Modules\Sirsoft\Ecommerce\Enums\PaymentStatusEnum;
use Modules\Sirsoft\Ecommerce\Models\Order;
use Modules\Sirsoft\Ecommerce\Models\OrderPayment;
use Plugins\Sirsoft\Pay\Nicepayments\Services\NicePaymentsApiService;

class PaymentRefundListener implements HookListenerInterface
{
    private const PG_PROVIDER_ID = 'nicepayments';

    public static function getSubscribedHooks(): array
    {
        return [
            'sirsoft-ecommerce.payment.refund' => [
                'method' => 'processRefund',
                'type' => 'filter',
                'priority' => 10,
            ],
        ];
    }

    public function handle(...$args): void {}

    public function processRefund(
        array $result,
        Order $order,
        OrderPayment $payment,
        float $refundAmount,
        ?string $reason = null,
    ): array {
        if ($payment->pg_provider !== self::PG_PROVIDER_ID) {
            return $result;
        }

        // 가상계좌 입금 완료 건은 환불 계좌 정보가 필요하므로 일반 훅으로 처리 불가
        if ($payment->vbank_number !== null
            && $payment->payment_status === PaymentStatusEnum::PAYMENT_COMPLETE) {
            return [
                'success' => false,
                'error_code' => 'VBANK_REQUIRES_BANK_INFO',
                'error_message' => '가상계좌 입금 완료 건은 환불계좌 정보가 필요합니다. 관리자 API를 통해 환불을 진행해주세요.',
                'transaction_id' => null,
            ];
        }

        $tid = $payment->transaction_id;
        if (! $tid) {
            return [
                'success' => false,
                'error_code' => 'MISSING_TID',
                'error_message' => __('sirsoft-pay-nicepayments::messages.refund.missing_tid'),
                'transaction_id' => null,
            ];
        }

        try {
            $apiService = app(NicePaymentsApiService::class);

            $cancelMsg = $reason ?? __('sirsoft-pay-nicepayments::messages.refund.default_reason');
            $cancelAmt = (int) $refundAmount;
            $maxRefundable = (int) $payment->amount;

            if ($cancelAmt <= 0 || $cancelAmt > $maxRefundable) {
                return [
                    'success' => false,
                    'error_code' => 'INVALID_REFUND_AMOUNT',
                    'error_message' => '환불 금액이 유효하지 않습니다.',
                    'transaction_id' => null,
                ];
            }

            $moid = (string) $order->order_number;

            $isPartial = $cancelAmt < $maxRefundable;
            $response = $apiService->cancelPayment($tid, $moid, $cancelAmt, $cancelMsg, $isPartial ? 1 : 0);

            Log::info('NicePayments: refund success', [
                'order_id' => $order->id,
                'tid' => $tid,
                'cancel_amt' => $cancelAmt,
            ]);

            return [
                'success' => true,
                'error_code' => null,
                'error_message' => null,
                'transaction_id' => $response['TID'] ?? $tid,
            ];
        } catch (\Exception $e) {
            Log::error('NicePayments: refund failed', [
                'order_id' => $order->id,
                'tid' => $tid,
                'cancel_amt' => (int) $refundAmount,
                'error' => $e->getMessage(),
            ]);

            HookManager::doAction('sirsoft-pay-nicepayments.payment.refund_failed', $order, $payment, [
                'tid' => $tid,
                'cancel_amt' => (int) $refundAmount,
                'error' => $e->getMessage(),
            ]);

            return [
                'success' => false,
                'error_code' => 'PG_API_ERROR',
                'error_message' => $e->getMessage(),
                'transaction_id' => null,
            ];
        }
    }
}
