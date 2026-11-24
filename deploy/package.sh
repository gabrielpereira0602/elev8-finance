#!/usr/bin/env bash
# Builds the upload package for Hostinger:
#   dist/app/          → domains/finance.elev8solucoes.com.br/app          (PHP code, outside public_html)
#   dist/public_html/  → domains/finance.elev8solucoes.com.br/public_html  (app + /api front controller)
# finance-private/config.php goes next to app/, never in the package.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist/app dist/public_html/api
(cd web && npm ci --silent && npm test --silent && npm run build --silent)
(cd api && composer dump-autoload -q --no-dev --optimize)
cp -r api/src api/vendor api/migrations api/bin api/composer.json dist/app/
cp -r web/dist/. dist/public_html/
cp api/public/api/index.php api/public/api/.htaccess dist/public_html/api/
echo "Pacote pronto em dist/"
