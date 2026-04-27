<?php

namespace Plugins\Sirsoft\Pay\Nicepayments\Controllers;

use App\Helpers\ResponseHelper;
use App\Http\Controllers\Api\Base\AdminBaseController;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Plugins\Sirsoft\Pay\Nicepayments\Services\NicePaymentsApiService;

class AdminTransactionController extends AdminBaseController
{
    public function __construct(
        private NicePaymentsApiService $apiService
    ) {
        parent::__construct();
    }

    public function query(Request $request): JsonResponse
    {
        $tid = trim((string) $request->input('tid', ''));

        if ($tid === '') {
            return ResponseHelper::error('messages.failed', 422, ['tid' => ['TID를 입력하세요.']]);
        }

        try {
            $result = $this->apiService->queryTransaction($tid);

            // 로컬 DB에서 에스크로 여부 조회하여 병합
            $localPayment = DB::table('ecommerce_order_payments')
                ->where('transaction_id', $tid)
                ->select(['is_escrow', 'payment_meta'])
                ->first();

            $result['_local_is_escrow'] = (bool) ($localPayment?->is_escrow ?? false);

            // payment_meta의 pg_raw_response에서도 EscrowYN 확인
            if ($localPayment?->payment_meta) {
                $meta = json_decode($localPayment->payment_meta, true);
                $result['EscrowYN'] = $meta['pg_raw_response']['EscrowYN']
                    ?? ($result['EscrowYN'] ?? 'N');
            }

            return ResponseHelper::success('messages.success', $result);
        } catch (\Exception $e) {
            return ResponseHelper::error('messages.failed', 502, null);
        }
    }
}
