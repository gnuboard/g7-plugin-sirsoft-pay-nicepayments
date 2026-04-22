<?php

declare(strict_types=1);

namespace Plugins\Sirsoft\Pay\Nicepayments\Services;

use App\Services\PluginSettingsService;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class NicePaymentsApiService
{
    private const CANCEL_URL = 'https://pg-api.nicepay.co.kr/webapi/cancel_process.jsp';

    private const PLUGIN_IDENTIFIER = 'sirsoft-pay-nicepayments';

    private bool $isTest;

    private string $mid;

    private string $merchantKey;

    public function __construct(PluginSettingsService $pluginSettingsService)
    {
        $settings = $pluginSettingsService->get(self::PLUGIN_IDENTIFIER) ?? [];
        $this->isTest = $settings['is_test_mode'] ?? true;
        $this->mid = $this->isTest
            ? ($settings['test_mid'] ?? '')
            : ($settings['live_mid'] ?? '');
        $this->merchantKey = $this->isTest
            ? ($settings['test_merchant_key'] ?? '')
            : ($settings['live_merchant_key'] ?? '');
    }

    public function getMid(): string
    {
        return $this->mid;
    }

    /**
     * 콜백 서명 검증 (MerchantKey 없는 1차 검증)
     *
     * @param string $authToken 인증 토큰
     * @param string $mid       가맹점 MID
     * @param int    $amt       결제 금액
     * @param string $signature 나이스페이먼츠가 전달한 서명
     */
    public function verifyCallbackSignature(string $authToken, string $mid, int $amt, string $signature): bool
    {
        $expected = bin2hex(hash('sha256', $authToken . $mid . (string) $amt . $this->merchantKey, true));

        return hash_equals($expected, $signature);
    }

    /**
     * 서버 승인 API 호출 (2단계 인증)
     *
     * @param string $nextAppUrl  나이스페이먼츠가 전달한 승인 URL
     * @param string $txTid       임시 거래번호
     * @param string $authToken   인증 토큰
     * @param int    $amt         결제 금액
     * @return array PG 응답 데이터
     * @throws \Exception API 호출 실패 시
     */
    public function authorizePayment(string $nextAppUrl, string $txTid, string $authToken, int $amt): array
    {
        $ediDate = $this->computeEdiDate();
        $signData = bin2hex(hash('sha256', $authToken . $this->mid . (string) $amt . $ediDate . $this->merchantKey, true));

        $response = Http::asForm()->post($nextAppUrl, [
            'TID' => $txTid,
            'AuthToken' => $authToken,
            'MID' => $this->mid,
            'Amt' => $amt,
            'EdiDate' => $ediDate,
            'SignData' => $signData,
            'CharSet' => 'utf-8',
        ]);

        if ($response->failed()) {
            throw new \Exception('NicePayments authorize API error: HTTP ' . $response->status());
        }

        return $response->json() ?? [];
    }

    /**
     * 결제 취소 API 호출
     *
     * @param string $tid               거래번호
     * @param string $moid              주문번호
     * @param int    $cancelAmt         취소 금액
     * @param string $cancelMsg         취소 사유
     * @param int    $partialCancelCode 0=전액취소, 1=부분취소
     * @return array PG 응답 데이터
     * @throws \Exception API 호출 실패 시
     */
    public function cancelPayment(
        string $tid,
        string $moid,
        int $cancelAmt,
        string $cancelMsg,
        int $partialCancelCode = 0,
    ): array {
        $ediDate = $this->computeEdiDate();
        $signData = bin2hex(hash('sha256', $this->mid . (string) $cancelAmt . $ediDate . $this->merchantKey, true));

        $response = Http::asForm()->post(self::CANCEL_URL, [
            'TID' => $tid,
            'MID' => $this->mid,
            'Moid' => $moid,
            'CancelAmt' => $cancelAmt,
            'CancelMsg' => $cancelMsg,
            'PartialCancelCode' => $partialCancelCode,
            'EdiDate' => $ediDate,
            'SignData' => $signData,
            'CharSet' => 'utf-8',
        ]);

        if ($response->failed()) {
            throw new \Exception('NicePayments cancel API error: HTTP ' . $response->status());
        }

        $result = $response->json() ?? [];

        if (($result['ResultCode'] ?? '') !== '2001') {
            Log::error('NicePayments cancel failed', [
                'result_code' => $result['ResultCode'] ?? 'UNKNOWN',
                'result_msg' => $result['ResultMsg'] ?? '',
                'tid' => $tid,
            ]);
            throw new \Exception($result['ResultMsg'] ?? 'NicePayments cancel failed');
        }

        return $result;
    }

    /**
     * 망취소 요청 (서버 승인 중 예외 발생 시 결제 원천 취소)
     *
     * @param string $netCancelUrl 나이스페이먼츠가 전달한 망취소 URL
     * @param string $authToken    인증 토큰
     */
    public function sendNetCancel(string $netCancelUrl, string $authToken): void
    {
        try {
            Http::asForm()->post($netCancelUrl, [
                'NetCancel' => 1,
                'AuthToken' => $authToken,
                'MID' => $this->mid,
            ]);
        } catch (\Throwable $e) {
            Log::error('NicePayments net cancel failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * EdiDate 생성 (YYYYMMDDHHmmss 형식, 숫자만)
     */
    private function computeEdiDate(): string
    {
        return preg_replace('/[^0-9]/', '', now()->format('Y-m-d H:i:s')) ?? now()->format('YmdHis');
    }
}
