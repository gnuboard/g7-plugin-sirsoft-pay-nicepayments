<?php

declare(strict_types=1);

namespace Plugins\Sirsoft\Pay\Nicepayments\Controllers;

use App\Extension\HookManager;
use App\Services\PluginSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Modules\Sirsoft\Ecommerce\Enums\PaymentStatusEnum;
use Modules\Sirsoft\Ecommerce\Exceptions\PaymentAmountMismatchException;
use Modules\Sirsoft\Ecommerce\Services\OrderProcessingService;
use Plugins\Sirsoft\Pay\Nicepayments\Http\Requests\AuthCallbackRequest;
use Plugins\Sirsoft\Pay\Nicepayments\Http\Requests\VbankNotifyRequest;
use Plugins\Sirsoft\Pay\Nicepayments\Services\NicePaymentsApiService;

/**
 * 나이스페이먼츠 결제 콜백 컨트롤러
 *
 * 나이스페이먼츠 결제는 2단계 인증 방식입니다:
 *  1단계: 브라우저가 POST 콜백으로 인증 토큰 전달 → authCallback()
 *  2단계: 서버가 NextAppURL로 최종 승인 요청 → NicePaymentsApiService::authorizePayment()
 */
class PaymentCallbackController
{
    private const PLUGIN_IDENTIFIER = 'sirsoft-pay-nicepayments';

    /** 성공 결제 방법 ResultCode 목록 */
    private const SUCCESS_RESULT_CODES = ['3001', '4000', '4100', 'A000', '7001'];

    public function __construct(
        private readonly OrderProcessingService $orderService,
        private readonly PluginSettingsService $pluginSettingsService,
        private readonly NicePaymentsApiService $apiService,
    ) {}

    /**
     * 나이스페이먼츠 결제 승인 콜백
     *
     * POST /plugins/sirsoft-pay-nicepayments/payment/callback
     * (CSRF 제외 - 나이스페이먼츠가 브라우저 통해 POST 전달)
     */
    public function authCallback(AuthCallbackRequest $request): \Illuminate\Http\RedirectResponse
    {
        $validated = $request->validated();

        $authResultCode = $validated['AuthResultCode'];
        $nextAppUrl = $validated['NextAppURL'];
        $txTid = $validated['TxTid'];
        $authToken = $validated['AuthToken'];
        $mid = $validated['MID'];
        $moid = $validated['Moid'];
        $amt = (int) $validated['Amt'];
        $netCancelUrl = $validated['NetCancelURL'];
        $signature = $validated['Signature'];

        // 1단계: 인증 결과 코드 확인
        if ($authResultCode !== '0000') {
            Log::warning('NicePayments: auth result failed', [
                'moid' => $moid,
                'auth_result_code' => $authResultCode,
                'auth_result_msg' => $validated['AuthResultMsg'] ?? '',
                'ip' => $request->ip(),
            ]);

            return redirect($this->resolveFailUrl([
                'error' => 'auth_failed',
                'orderId' => $moid,
            ]));
        }

        // 2단계: MID 일치 확인
        if ($mid !== $this->apiService->getMid()) {
            Log::error('NicePayments: MID mismatch', [
                'received_mid' => $mid,
                'config_mid' => $this->apiService->getMid(),
                'moid' => $moid,
                'ip' => $request->ip(),
            ]);

            return redirect($this->resolveFailUrl(['error' => 'mid_mismatch', 'orderId' => $moid]));
        }

        // 3단계: 서명 검증
        if (! $this->apiService->verifyCallbackSignature($authToken, $mid, $amt, $signature)) {
            Log::error('NicePayments: signature verification failed', ['moid' => $moid, 'ip' => $request->ip()]);

            return redirect($this->resolveFailUrl(['error' => 'signature_mismatch', 'orderId' => $moid]));
        }

        try {
            // 주문 조회
            $order = $this->orderService->findByOrderNumber($moid);

            if (! $order) {
                Log::error('NicePayments: order not found', ['moid' => $moid]);

                return redirect($this->resolveFailUrl(['error' => 'order_not_found', 'orderId' => $moid]));
            }

            HookManager::doAction('sirsoft-pay-nicepayments.payment.before_authorize', $order, $validated);

            // 4단계: 서버 승인 API 호출
            $pgResponse = $this->apiService->authorizePayment($nextAppUrl, $txTid, $authToken, $amt);

            HookManager::doAction('sirsoft-pay-nicepayments.payment.after_authorize', $order, $pgResponse);

            $resultCode = $pgResponse['ResultCode'] ?? '';

            if (! in_array($resultCode, self::SUCCESS_RESULT_CODES, true)) {
                Log::warning('NicePayments: authorize failed', [
                    'moid' => $moid,
                    'result_code' => $resultCode,
                    'result_msg' => $pgResponse['ResultMsg'] ?? '',
                ]);

                $this->orderService->failPayment($order, $resultCode, $pgResponse['ResultMsg'] ?? '');

                return redirect($this->resolveFailUrl([
                    'error' => 'authorize_failed',
                    'orderId' => $moid,
                ]));
            }

            // 5단계: 승인 응답 Signature 검증 — hex(sha256(TID+MID+Amt+MerchantKey))
            $approvalTid = $pgResponse['TID'] ?? $txTid;
            $approvalSignature = $pgResponse['Signature'] ?? '';
            if ($approvalSignature !== '' && ! $this->apiService->verifyApprovalSignature($approvalTid, $amt, $approvalSignature)) {
                Log::critical('NicePayments: approval response signature mismatch', [
                    'moid' => $moid,
                    'tid' => $approvalTid,
                    'ip' => $request->ip(),
                ]);
                $this->apiService->sendNetCancel($netCancelUrl, $txTid, $authToken, $amt);

                return redirect($this->resolveFailUrl(['error' => 'signature_mismatch', 'orderId' => $moid]));
            }

            // 6단계: 결제 수단별 처리
            $payMethod = $pgResponse['PayMethod'] ?? '';

            if ($payMethod === 'VBANK') {
                // 가상계좌: 계좌 발급 완료 → 입금 대기 상태로 전환
                // 실제 결제 완료(PAYMENT_COMPLETE)는 입금 후 vbankNotify()에서 처리
                $vbankDueAt = null;
                if (isset($pgResponse['VbankExpDate'])) {
                    $dateStr = $pgResponse['VbankExpDate'] . ($pgResponse['VbankExpTime'] ?? '235959');
                    $vbankDueAt = \Carbon\Carbon::createFromFormat('YmdHis', $dateStr);
                }

                $payment = $order->payment;
                if ($payment) {
                    $payment->payment_status = PaymentStatusEnum::WAITING_DEPOSIT;
                    $payment->vbank_name = $pgResponse['VbankBankName'] ?? null;
                    $payment->vbank_number = $pgResponse['VbankNum'] ?? null;
                    $payment->vbank_due_at = $vbankDueAt;
                    $payment->vbank_issued_at = now();
                    $payment->payment_meta = [
                        'result_code' => $resultCode,
                        'pay_method' => $payMethod,
                        'auth_date' => $pgResponse['AuthDate'] ?? null,
                        'vbank_tid' => $pgResponse['TID'] ?? $txTid,
                        'vbank_num' => $pgResponse['VbankNum'] ?? null,
                        'vbank_name' => $pgResponse['VbankBankName'] ?? null,
                        'vbank_exp_date' => isset($pgResponse['VbankExpDate'])
                            ? $pgResponse['VbankExpDate'] . ($pgResponse['VbankExpTime'] ?? '235959')
                            : null,
                        'pg_raw_response' => $this->sanitizePgResponse($pgResponse),
                    ];
                    $payment->save();
                }

                Log::info('NicePayments: vbank account issued', [
                    'moid' => $moid,
                    'vbank_name' => $pgResponse['VbankBankName'] ?? null,
                    'vbank_number' => $pgResponse['VbankNum'] ?? null,
                ]);
            } else {
                // 신용카드/기타: 즉시 결제 완료 처리
                $this->orderService->completePayment($order, [
                    'transaction_id' => $pgResponse['TID'] ?? $txTid,
                    'card_approval_number' => $pgResponse['AppNo'] ?? null,
                    'card_number_masked' => $pgResponse['CardNum'] ?? null,
                    'card_name' => $pgResponse['IssuCardName'] ?? $pgResponse['CardName'] ?? null,
                    'card_installment_months' => (int) ($pgResponse['CardQuota'] ?? 0),
                    'is_interest_free' => false,
                    'embedded_pg_provider' => null,
                    'receipt_url' => $pgResponse['ReceiptUrl'] ?? null,
                    'payment_meta' => [
                        'result_code' => $resultCode,
                        'pay_method' => $payMethod,
                        'auth_date' => $pgResponse['AuthDate'] ?? null,
                        'pg_raw_response' => $this->sanitizePgResponse($pgResponse),
                    ],
                    'payment_device' => $this->detectDevice($request),
                ], $amt);
            }

            return redirect($this->resolveSuccessUrl($moid));

        } catch (PaymentAmountMismatchException $e) {
            Log::error('NicePayments: amount mismatch', [
                'moid' => $moid,
                'expected' => $e->getExpectedAmount(),
                'actual' => $e->getActualAmount(),
            ]);

            $this->apiService->sendNetCancel($netCancelUrl, $txTid, $authToken, $amt);

            return redirect($this->resolveFailUrl(['error' => 'amount_mismatch', 'orderId' => $moid]));

        } catch (\Exception $e) {
            Log::error('NicePayments: authorize exception', [
                'moid' => $moid,
                'error' => $e->getMessage(),
            ]);

            $this->apiService->sendNetCancel($netCancelUrl, $txTid, $authToken, $amt);

            return redirect($this->resolveFailUrl([
                'error' => 'authorize_failed',
                'orderId' => $moid,
            ]));
        }
    }

    /**
     * 결제 요청 SignData 생성
     *
     * POST /plugins/sirsoft-pay-nicepayments/payment/sign-data
     */
    public function signData(Request $request): JsonResponse
    {
        $amt = (int) $request->input('amt', 0);
        $moid = (string) $request->input('moid', '');

        if ($amt <= 0 || $moid === '') {
            return response()->json(['error' => '잘못된 요청입니다.'], 400);
        }

        // 주문 금액 검증: 클라이언트가 임의 금액으로 SignData를 요청하는 조작 방지
        $order = $this->orderService->findByOrderNumber($moid);

        if (! $order) {
            Log::warning('NicePayments: SignData - order not found', [
                'moid' => $moid,
                'ip' => $request->ip(),
            ]);

            return response()->json(['error' => '주문을 찾을 수 없습니다.'], 422);
        }

        if ((int) $order->total_amount !== $amt) {
            Log::warning('NicePayments: SignData amount mismatch', [
                'moid' => $moid,
                'requested_amt' => $amt,
                'actual_amt' => $order->total_amount,
                'ip' => $request->ip(),
            ]);

            return response()->json(['error' => '요청 금액이 유효하지 않습니다.'], 422);
        }

        $ediDate = $this->apiService->generateEdiDate();
        $signData = $this->apiService->generateSignData($ediDate, $amt);

        return response()->json([
            'ediDate' => $ediDate,
            'signData' => $signData,
            'mid' => $this->apiService->getMid(),
        ]);
    }

    /**
     * 가상계좌 입금 통보 처리
     *
     * POST /plugins/sirsoft-pay-nicepayments/payment/vbank-notify
     * (나이스페이먼츠 서버 → 우리 서버, CSRF 제외)
     */
    public function vbankNotify(VbankNotifyRequest $request): Response
    {
        $validated = $request->validated();

        $tid = $validated['TID'];
        $moid = $validated['Moid'];
        $amt = (int) $validated['Amt'];
        $vbankResult = (string) $validated['VbankResult'];
        $signature = $validated['Signature'] ?? null;

        // 서명 검증 (입금 통보 위변조 감지)
        if ($signature !== null && ! $this->apiService->verifyVbankNotifySignature($tid, $amt, $signature)) {
            Log::critical('NicePayments: vbank notify signature mismatch', [
                'tid' => $tid,
                'moid' => $moid,
                'ip' => $request->ip(),
            ]);

            return response('FAIL', 200)->header('Content-Type', 'text/plain');
        }

        if ($vbankResult !== '1') {
            Log::warning('NicePayments: vbank deposit cancelled', ['tid' => $tid, 'moid' => $moid]);

            return response('OK', 200)->header('Content-Type', 'text/plain');
        }

        try {
            $order = $this->orderService->findByOrderNumber($moid);

            if (! $order) {
                Log::error('NicePayments: vbank notify - order not found', ['moid' => $moid, 'tid' => $tid]);

                return response('FAIL', 200)->header('Content-Type', 'text/plain');
            }

            $alreadyProcessed = false;

            DB::transaction(function () use ($order, $tid, $amt, $validated, &$alreadyProcessed): void {
                // 동시 입금 통보 중복 처리 방지: 행 단위 잠금
                $payment = $order->payment()->lockForUpdate()->first();

                if ($payment && $payment->transaction_id === $tid) {
                    $alreadyProcessed = true;

                    return;
                }

                $this->orderService->completePayment($order, [
                    'transaction_id' => $tid,
                    'payment_meta' => [
                        'result_code' => '4100',
                        'vbank_auth_date' => $validated['VbankAuthDate'] ?? null,
                        'vbank_num' => $validated['VbankNum'] ?? null,
                        'vbank_name' => $validated['VbankName'] ?? null,
                        'pg_raw_response' => $this->sanitizePgResponse($validated),
                    ],
                ], $amt);
            });

            if ($alreadyProcessed) {
                Log::info('NicePayments: vbank notify - already processed', ['tid' => $tid, 'moid' => $moid]);
            } else {
                Log::info('NicePayments: vbank deposit confirmed', ['tid' => $tid, 'moid' => $moid, 'amt' => $amt]);
            }

            return response('OK', 200)->header('Content-Type', 'text/plain');

        } catch (\Exception $e) {
            Log::error('NicePayments: vbank notify failed', [
                'tid' => $tid,
                'moid' => $moid,
                'error' => $e->getMessage(),
            ]);

            return response('FAIL', 200)->header('Content-Type', 'text/plain');
        }
    }

    private function resolveSuccessUrl(string $orderId): string
    {
        $settings = $this->pluginSettingsService->get(self::PLUGIN_IDENTIFIER) ?? [];
        $urlTemplate = $settings['redirect_success_url'] ?? '/shop/orders/{orderId}/complete';

        return str_replace('{orderId}', $orderId, $urlTemplate);
    }

    private function resolveFailUrl(array $queryParams = []): string
    {
        $settings = $this->pluginSettingsService->get(self::PLUGIN_IDENTIFIER) ?? [];
        $baseUrl = $settings['redirect_fail_url'] ?? '/shop/checkout';

        if (empty($queryParams)) {
            return $baseUrl;
        }

        $query = http_build_query(array_filter($queryParams));
        $separator = str_contains($baseUrl, '?') ? '&' : '?';

        return $baseUrl . $separator . $query;
    }

    /** PG 응답에서 개인정보(PII) 필드 제거 후 반환 */
    private function sanitizePgResponse(array $response): array
    {
        $piiFields = ['BuyerName', 'BuyerEmail', 'BuyerTel', 'CardNum'];

        return array_diff_key($response, array_flip($piiFields));
    }

    private function detectDevice(Request $request): string
    {
        $userAgent = $request->userAgent() ?? '';
        $mobileKeywords = ['Mobile', 'Android', 'iPhone', 'iPad', 'iPod'];

        foreach ($mobileKeywords as $keyword) {
            if (stripos($userAgent, $keyword) !== false) {
                return 'mobile';
            }
        }

        return 'pc';
    }
}
