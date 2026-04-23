<?php

use Illuminate\Support\Facades\Route;
use Plugins\Sirsoft\Pay\Nicepayments\Controllers\AdminTransactionController;

/*
|--------------------------------------------------------------------------
| NicePayments Plugin API Routes
|--------------------------------------------------------------------------
|
| 프리픽스: /api/plugins/sirsoft-pay-nicepayments (PluginRouteServiceProvider 자동 적용)
| 미들웨어: api (PluginRouteServiceProvider 자동 적용)
|
*/

Route::prefix('admin')->name('admin.')->group(function () {
    // TID 단건 거래 조회
    Route::post('/transaction/query', [AdminTransactionController::class, 'query'])
        ->name('transaction.query');
});
