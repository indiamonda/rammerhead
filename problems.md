# Remaining Proxy Issues

## 1. docs.google.com — 400 Bad Request on auth redirect

Google validates the `continue` URL in the auth redirect chain. The proxy rewrites it to a shuffled URL which fails Google's domain validation.

## 2. amazon.com — AWS WAF JS challenge (202)

AWS WAF returns a 202 challenge page instead of the real site. The challenge page contains JavaScript that must execute in the browser to generate a token cookie. Subsequent requests with the cookie should pass through.

## 3. binance.com — AWS WAF JS challenge (202)

Same as amazon.com — both sit behind CloudFront + AWS WAF.
