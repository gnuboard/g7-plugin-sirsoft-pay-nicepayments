<?php

declare(strict_types=1);

namespace Plugins\Sirsoft\Pay\Nicepayments\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

/**
 * 나이스페이먼츠 결제 승인 콜백 요청 검증
 *
 * POST /plugins/sirsoft-pay-nicepayments/payment/callback
 *
 * 나이스페이먼츠가 브라우저를 통해 POST 방식으로 전달하는 파라미터입니다.
 */
class AuthCallbackRequest extends FormRequest
{
    private const PLUGIN_IDENTIFIER = 'sirsoft-pay-nicepayments';

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'AuthResultCode' => ['required', 'string'],
            'AuthResultMsg' => ['nullable', 'string'],
            'NextAppURL' => ['required', 'string', 'url'],
            'TxTid' => ['required', 'string'],
            'AuthToken' => ['required', 'string'],
            'PayMethod' => ['required', 'string'],
            'MID' => ['required', 'string'],
            'Moid' => ['required', 'string'],
            'Amt' => ['required', 'integer', 'min:1'],
            'NetCancelURL' => ['required', 'string', 'url'],
            'Signature' => ['required', 'string'],
        ];
    }

    protected function failedValidation(Validator $validator): void
    {
        $settings = plugin_settings(self::PLUGIN_IDENTIFIER);
        $baseUrl = $settings['redirect_fail_url'] ?? '/shop/checkout';
        $separator = str_contains($baseUrl, '?') ? '&' : '?';

        throw new HttpResponseException(
            redirect($baseUrl . $separator . http_build_query(['error' => 'invalid_params']))
        );
    }
}
