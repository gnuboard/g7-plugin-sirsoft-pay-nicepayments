<?php

declare(strict_types=1);

namespace Plugins\Sirsoft\Pay\Nicepayments\Controllers;

use App\Helpers\ResponseHelper;
use App\Http\Controllers\Api\Base\AdminBaseController;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Plugins\Sirsoft\Pay\Nicepayments\Services\NicePaymentsApiService;

class AdminEscrowController extends AdminBaseController
{
    public function __construct(
        private readonly NicePaymentsApiService $apiService,
    ) {
        parent::__construct();
    }

    /**
     * 에스크로 배송 등록
     *
     * POST /api/plugins/sirsoft-pay-nicepayments/admin/escrow/register-delivery
     */
    public function registerDelivery(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'tid' => 'required|string',
            'delivery_name' => 'required|string|max:100',
            'tracking_number' => 'required|string|max:100',
            'buyer_address' => 'required|string|max:200',
            'register_name' => 'required|string|max:50',
        ]);

        try {
            $result = $this->apiService->registerEscrowDelivery(
                tid: $validated['tid'],
                deliveryName: $validated['delivery_name'],
                trackingNumber: $validated['tracking_number'],
                buyerAddress: $validated['buyer_address'],
                registerName: $validated['register_name'],
            );

            Log::info('NicePayments: escrow delivery registered', [
                'tid' => $validated['tid'],
                'delivery_name' => $validated['delivery_name'],
                'tracking_number' => $validated['tracking_number'],
            ]);

            return ResponseHelper::success('messages.success', $result);
        } catch (\Exception $e) {
            return ResponseHelper::error($e->getMessage(), 502, null);
        }
    }
}
