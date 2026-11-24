<?php
declare(strict_types=1);

// Front controller for /api/*. Secrets live OUTSIDE public_html (see README: finance-private/config.php).
use Elev8\Finance\App;
use Elev8\Finance\Db;

$root = dirname(__DIR__, 2);
require $root . '/vendor/autoload.php';

$configPath = getenv('FINANCE_CONFIG') ?: dirname($root) . '/finance-private/config.php';
if (!is_file($configPath)) {
    http_response_code(503);
    header('Content-Type: application/json');
    echo '{"error":"not_configured"}';
    exit;
}
$config = require $configPath;
date_default_timezone_set('America/Sao_Paulo');

$headers = [];
foreach (getallheaders() as $k => $v) {
    $headers[strtolower($k)] = $v;
}
$app = new App(Db::connect($config['db']), $config);
$res = $app->handle(
    $_SERVER['REQUEST_METHOD'] ?? 'GET',
    $_SERVER['REQUEST_URI'] ?? '/',
    $_GET,
    (string) file_get_contents('php://input', false, null, 0, App::MAX_BODY + 1),
    $headers,
    $_COOKIE,
    $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'
);

header_remove('X-Powered-By');
http_response_code($res['status']);
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
foreach ($res['cookies'] as $c) {
    header('Set-Cookie: ' . $c, false);
}
foreach ($res['headers'] as $k => $v) {
    header("$k: $v");
}
if (is_string($res['body'])) {
    echo $res['body'];
} else {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($res['body'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
