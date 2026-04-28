<?php

declare(strict_types=1);

namespace Plugins\Sirsoft\Pay\Nicepayments\Listeners;

use App\Contracts\Extension\HookListenerInterface;

class RegisterPgProviderListener implements HookListenerInterface
{
    private const PLUGIN_IDENTIFIER = 'sirsoft-pay-nicepayments';

    public static function getSubscribedHooks(): array
    {
        return [
            'sirsoft-ecommerce.payment.registered_pg_providers' => [
                'method' => 'registerProvider',
                'type' => 'filter',
                'priority' => 10,
            ],
            'sirsoft-ecommerce.payment.get_client_config' => [
                'method' => 'getClientConfig',
                'type' => 'filter',
                'priority' => 10,
            ],
        ];
    }

    public function handle(...$args): void {}

    public function registerProvider(array $providers): array
    {
        $providers[] = [
            'id' => 'nicepayments',
            'name' => ['ko' => '나이스페이먼츠', 'en' => 'NicePayments'],
            'icon' => 'credit-card',
            'supported_methods' => ['card', 'bank_transfer', 'virtual_account', 'mobile'],
        ];

        return $providers;
    }

    public function getClientConfig(array $config, string $provider): array
    {
        if ($provider !== 'nicepayments') {
            return $config;
        }

        $settings = $this->getPluginSettings();
        $isTest = $settings['is_test_mode'] ?? true;

        $liveMid = $settings['live_mid'] ?? '';
        $liveMid = str_starts_with($liveMid, 'SR') ? $liveMid : 'SR' . $liveMid;

        $easyPayKeys = ['NAVERPAY' => 'easy_pay_naverpay', 'KAKAOPAY' => 'easy_pay_kakaopay', 'SAMSUNGPAY' => 'easy_pay_samsungpay', 'APPLEPAY' => 'easy_pay_applepay', 'PAYCO' => 'easy_pay_payco', 'SKPAY' => 'easy_pay_skpay', 'SSGPAY' => 'easy_pay_ssgpay', 'LPAY' => 'easy_pay_lpay'];
        $enabledEasyPays = array_values(array_keys(array_filter($easyPayKeys, fn ($key) => (bool) ($settings[$key] ?? false))));

        return array_merge($config, [
            'mid' => $isTest
                ? ($settings['test_mid'] ?? '')
                : $liveMid,
            'sdk_url' => 'https://web.nicepay.co.kr/v3/webstd/js/nicepay-3.0.js',
            'callback_url' => '/plugins/sirsoft-pay-nicepayments/payment/callback',
            'sign_data_url' => '/plugins/sirsoft-pay-nicepayments/payment/sign-data',
            'useEscrow' => (bool) ($settings['use_escrow'] ?? false),
            'enabled_easy_pays' => $enabledEasyPays,
        ]);
    }

    private function getPluginSettings(): array
    {
        return plugin_settings(self::PLUGIN_IDENTIFIER);
    }
}
