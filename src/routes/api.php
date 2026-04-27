<?php

use Illuminate\Support\Facades\Route;
use Plugins\Sirsoft\Pay\Nicepayments\Controllers\AdminTransactionController;
use Plugins\Sirsoft\Pay\Nicepayments\Controllers\AdminVbankRefundController;
use Plugins\Sirsoft\Pay\Nicepayments\Controllers\UserReceiptController;

/*
|--------------------------------------------------------------------------
| NicePayments Plugin API Routes
|--------------------------------------------------------------------------
|
| 프리픽스: /api/plugins/sirsoft-pay-nicepayments (PluginRouteServiceProvider 자동 적용)
| 미들웨어: api (PluginRouteServiceProvider 자동 적용)
|
*/

Route::middleware(['auth:sanctum'])->group(function () {
    Route::get('/user/orders/{orderNumber}/receipt', [UserReceiptController::class, 'show'])
        ->name('user.orders.receipt');
});

Route::prefix('admin')->name('admin.')->middleware(['auth:sanctum', 'admin'])->group(function () {
    // 가상계좌 입금통보 URL 조회 (관리자 설정 페이지 표시용)
    Route::get('/vbank-notify-url', function () {
        return response()->json([
            'success' => true,
            'data' => [
                'url' => url('/plugins/sirsoft-pay-nicepayments/payment/vbank-notify'),
            ],
        ]);
    })->name('vbank.notify.url');

    // TID 단건 거래 조회
    Route::post('/transaction/query', [AdminTransactionController::class, 'query'])
        ->name('transaction.query');

    // 가상계좌 입금 완료 건 환불 (환불 계좌 정보 필요)
    Route::post('/vbank-refund', [AdminVbankRefundController::class, 'refund'])
        ->name('vbank.refund');
});
