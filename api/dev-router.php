<?php
// Local only: serves the built app (web/dist) and the API from one origin, like the subdomain will.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/api')) {
    require __DIR__ . '/public/api/index.php';
    return true;
}
$file = realpath(__DIR__ . '/../web/dist' . $path);
if ($file && is_file($file) && str_starts_with($file, realpath(__DIR__ . '/../web/dist'))) {
    $types = ['js' => 'text/javascript', 'css' => 'text/css', 'svg' => 'image/svg+xml', 'png' => 'image/png', 'webmanifest' => 'application/manifest+json', 'woff2' => 'font/woff2', 'html' => 'text/html', 'ico' => 'image/x-icon'];
    header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
    readfile($file);
    return true;
}
readfile(__DIR__ . '/../web/dist/index.html');
return true;
