<?php
/**
 * Plugin Name: Magical Crete — Device Verification Code
 * Description: Adds a REST endpoint that emails a 6-digit device-verification code for the Explore Crete app login. Used by the Base44 app's device-based login protection.
 * Version: 1.0
 * Author: Magical Crete
 *
 * SETUP (one-time):
 * 1. Install this file as a plugin: copy to /wp-content/plugins/magical-crete-device-code/magical-crete-device-code.php
 *    (or paste into your theme's functions.php if you prefer).
 * 2. Add this line to wp-config.php (above the "That's all, stop editing!" line),
 *    replacing the value with the SAME long random string you set as the
 *    MC_DEVICE_CODE_SECRET in your Base44 app settings:
 *
 *      define('MC_DEVICE_CODE_SECRET', 'paste-the-same-secret-here');
 *
 * 3. Activate the plugin (Plugins → Installed Plugins → "Magical Crete — Device Verification Code" → Activate).
 *
 * The endpoint is: POST https://YOUR-SITE/wp-json/magicalcrete/v1/device-code
 * It expects a JSON body { "email": "...", "code": "123456" } and an
 * X-MC-Secret header matching MC_DEVICE_CODE_SECRET.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('MC_DEVICE_CODE_REST_NAMESPACE', 'magicalcrete/v1');

add_action('rest_api_init', function () {
    register_rest_route(MC_DEVICE_CODE_REST_NAMESPACE, '/device-code', array(
        'methods'             => 'POST',
        'callback'            => 'mc_device_code_send',
        'permission_callback' => '__return_true',
    ));
});

function mc_device_code_send(WP_REST_Request $request) {
    $secret   = defined('MC_DEVICE_CODE_SECRET') ? MC_DEVICE_CODE_SECRET : '';
    $provided = $request->get_header('x_mc_secret');

    if (empty($secret) || !hash_equals($secret, (string) $provided)) {
        return new WP_REST_Response(array('error' => 'Unauthorized'), 401);
    }

    $body  = json_decode($request->get_body(), true);
    $email = isset($body['email']) ? sanitize_email($body['email']) : '';
    $code  = isset($body['code']) ? preg_replace('/[^0-9]/', '', $body['code']) : '';

    if (!is_email($email) || strlen($code) !== 6) {
        return new WP_REST_Response(array('error' => 'Invalid payload'), 400);
    }

    $site_name = get_bloginfo('name') ?: 'Magical Crete';

    $subject = '[' . $site_name . '] Your sign-in code';
    $message  = "Hello,\n\n";
    $message .= "We received a sign-in attempt on a new device for your " . $site_name . " account.\n\n";
    $message .= "Your verification code is: " . $code . "\n\n";
    $message .= "This code expires in 10 minutes.\n\n";
    $message .= "If you did not request this, you can safely ignore this email — no one else can sign in without this code.\n\n";
    $message .= "— The " . $site_name . " Team";

    $headers = array('Content-Type: text/plain; charset=UTF-8');

    $sent = wp_mail($email, $subject, $message, $headers);

    if (!$sent) {
        return new WP_REST_Response(array('error' => 'Email send failed'), 500);
    }

    return new WP_REST_Response(array('sent' => true), 200);
}