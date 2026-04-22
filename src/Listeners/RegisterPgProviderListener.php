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

        return array_merge($config, [
            'client_id' => $isTest
                ? ($settings['test_mid'] ?? '')
                : ($settings['live_mid'] ?? ''),
            'sdk_url' => 'https://pay.nicepay.co.kr/v1/js/',
            'callback_urls' => [
                'callback' => '/plugins/sirsoft-pay-nicepayments/payment/callback',
            ],
        ]);
    }

    private function getPluginSettings(): array
    {
        return plugin_settings(self::PLUGIN_IDENTIFIER);
    }
}
