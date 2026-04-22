<?php

namespace Plugins\Sirsoft\Pay\Nicepayments;

use App\Extension\AbstractPlugin;

/**
 * 나이스페이먼츠 PG 플러그인
 *
 * 나이스페이먼츠 통합결제창(카드/계좌이체/가상계좌/휴대폰) 연동을 제공합니다.
 * sirsoft-ecommerce 모듈 전용 플러그인입니다.
 */
class Plugin extends AbstractPlugin
{
    public function getMetadata(): array
    {
        return [
            'author' => 'Sirsoft',
            'license' => 'MIT',
            'homepage' => 'https://sir.kr',
            'keywords' => ['payment', 'nicepayments', 'nicepay', 'pg', 'card', 'ecommerce'],
        ];
    }

    public function getSettingsSchema(): array
    {
        return [
            'is_test_mode' => [
                'type' => 'boolean',
                'default' => true,
                'label' => ['ko' => '테스트 모드', 'en' => 'Test Mode'],
                'hint' => [
                    'ko' => '테스트 모드에서는 실제 결제가 발생하지 않습니다.',
                    'en' => 'No real payments occur in test mode.',
                ],
            ],
            'test_mid' => [
                'type' => 'string',
                'default' => '',
                'label' => ['ko' => '테스트 가맹점 ID (MID)', 'en' => 'Test Merchant ID (MID)'],
                'hint' => [
                    'ko' => '나이스페이먼츠에서 발급받은 테스트 MID',
                    'en' => 'Test MID issued by NicePayments',
                ],
            ],
            'test_merchant_key' => [
                'type' => 'string',
                'default' => '',
                'sensitive' => true,
                'label' => ['ko' => '테스트 가맹점 키', 'en' => 'Test Merchant Key'],
                'hint' => [
                    'ko' => '외부에 노출되지 않도록 주의하세요.',
                    'en' => 'Keep this key secret.',
                ],
            ],
            'live_mid' => [
                'type' => 'string',
                'default' => '',
                'label' => ['ko' => '라이브 가맹점 ID (MID)', 'en' => 'Live Merchant ID (MID)'],
            ],
            'live_merchant_key' => [
                'type' => 'string',
                'default' => '',
                'sensitive' => true,
                'label' => ['ko' => '라이브 가맹점 키', 'en' => 'Live Merchant Key'],
                'hint' => [
                    'ko' => '외부에 노출되지 않도록 주의하세요.',
                    'en' => 'Keep this key secret.',
                ],
            ],
            'redirect_success_url' => [
                'type' => 'string',
                'default' => '/shop/orders/{orderId}/complete',
                'label' => ['ko' => '결제 성공 리다이렉트 URL', 'en' => 'Payment Success Redirect URL'],
                'hint' => [
                    'ko' => '상대 경로(/shop/...) 또는 전체 URL(https://...) 모두 가능합니다. {orderId}는 주문번호로 자동 치환됩니다.',
                    'en' => 'Supports relative paths (/shop/...) or full URLs (https://...). {orderId} will be replaced with the actual order number.',
                ],
            ],
            'redirect_fail_url' => [
                'type' => 'string',
                'default' => '/shop/checkout',
                'label' => ['ko' => '결제 실패 리다이렉트 URL', 'en' => 'Payment Failure Redirect URL'],
                'hint' => [
                    'ko' => '상대 경로 또는 전체 URL 모두 가능합니다. 오류 정보는 쿼리 파라미터로 자동 추가됩니다.',
                    'en' => 'Supports relative paths or full URLs. Error details are appended as query parameters.',
                ],
            ],
        ];
    }

    public function getConfigValues(): array
    {
        return [
            'is_test_mode' => true,
            'test_mid' => '',
            'test_merchant_key' => '',
            'live_mid' => '',
            'live_merchant_key' => '',
            'redirect_success_url' => '/shop/orders/{orderId}/complete',
            'redirect_fail_url' => '/shop/checkout',
        ];
    }

    public function getHookListeners(): array
    {
        return [
            Listeners\RegisterPgProviderListener::class,
            Listeners\PaymentRefundListener::class,
        ];
    }

    public function getHooks(): array
    {
        return [
            [
                'name' => 'sirsoft-pay-nicepayments.payment.before_authorize',
                'type' => 'action',
                'description' => [
                    'ko' => '나이스페이먼츠 서버 승인 API 호출 전',
                    'en' => 'Before NicePayments server authorization API call',
                ],
            ],
            [
                'name' => 'sirsoft-pay-nicepayments.payment.after_authorize',
                'type' => 'action',
                'description' => [
                    'ko' => '나이스페이먼츠 서버 승인 완료 후',
                    'en' => 'After NicePayments server authorization completed',
                ],
            ],
        ];
    }
}
