<?php

use Illuminate\Support\Facades\Route;
use Plugins\Sirsoft\Pay\Nicepayments\Controllers\PaymentCallbackController;

/*
|--------------------------------------------------------------------------
| NicePayments Plugin Web Routes
|--------------------------------------------------------------------------
|
| 프리픽스: /plugins/sirsoft-pay-nicepayments (PluginRouteServiceProvider 자동 적용)
| 미들웨어: web (PluginRouteServiceProvider 자동 적용)
|
| 나이스페이먼츠는 브라우저 POST 콜백 방식이므로 CSRF 미들웨어를 제외합니다.
|
*/

Route::withoutMiddleware([\Illuminate\Foundation\Http\Middleware\ValidateCsrfToken::class])
    ->group(function () {
        // 결제 승인 콜백 (나이스페이먼츠 → 브라우저 POST)
        Route::post('/payment/callback', [PaymentCallbackController::class, 'authCallback'])
            ->name('payment.callback');

        // SignData 생성 (브라우저 AJAX → 서버)
        Route::post('/payment/sign-data', [PaymentCallbackController::class, 'signData'])
            ->name('payment.sign-data');

        // 가상계좌 입금 통보 (나이스페이먼츠 서버 → 우리 서버 POST)
        Route::post('/payment/vbank-notify', [PaymentCallbackController::class, 'vbankNotify'])
            ->name('payment.vbank-notify');
    });
