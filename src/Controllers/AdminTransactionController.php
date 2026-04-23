<?php

namespace Plugins\Sirsoft\Pay\Nicepayments\Controllers;

use App\Helpers\ResponseHelper;
use App\Http\Controllers\Api\Base\AdminBaseController;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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

            return ResponseHelper::success('messages.success', $result);
        } catch (\Exception $e) {
            return ResponseHelper::error('messages.failed', 502, null);
        }
    }
}
