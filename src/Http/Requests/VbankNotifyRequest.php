<?php

declare(strict_types=1);

namespace Plugins\Sirsoft\Pay\Nicepayments\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * 나이스페이먼츠 가상계좌 입금 통보 요청 검증
 *
 * POST /plugins/sirsoft-pay-nicepayments/payment/vbank-notify
 *
 * 나이스페이먼츠 서버가 직접 호출하는 입금 확인 웹훅입니다.
 * 허용 IP: 121.133.126.10, 121.133.126.11, 211.33.136.39
 */
class VbankNotifyRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'TID' => ['required', 'string'],
            'Moid' => ['required', 'string'],
            'Amt' => ['required', 'integer', 'min:1'],
            'VbankResult' => ['required', 'in:1,0'],
            'VbankAuthDate' => ['nullable', 'string'],
            'VbankNum' => ['nullable', 'string'],
            'VbankName' => ['nullable', 'string'],
        ];
    }
}
