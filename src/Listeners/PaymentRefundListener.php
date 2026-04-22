<?php

declare(strict_types=1);

namespace Plugins\Sirsoft\Pay\Nicepayments\Listeners;

use App\Contracts\Extension\HookListenerInterface;
use Illuminate\Support\Facades\Log;
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
            $moid = (string) $order->order_number;

            $isPartial = $cancelAmt < (int) $payment->amount;
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

            return [
                'success' => false,
                'error_code' => 'PG_API_ERROR',
                'error_message' => $e->getMessage(),
                'transaction_id' => null,
            ];
        }
    }
}
