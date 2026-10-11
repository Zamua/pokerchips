.PHONY: help build test typecheck e2e smoke dev worker

# Developer targets only. Deploying is the operator's business and lives
# outside this repository.

help:
	@echo "make dev        client dev server (Vite; proxies /api to 127.0.0.1:8787)"
	@echo "make worker     the Worker with its Durable Objects (wrangler dev on 8787)"
	@echo "make build      client bundle to client/dist"
	@echo "make test       unit and Worker tests"
	@echo "make typecheck  TypeScript across domain, Worker and client"
	@echo "make e2e        Playwright, two phones, Chromium and WebKit"
	@echo "make smoke      smoke test against SMOKE_BASE_URL"

build:
	npm run build

test:
	npm test

typecheck:
	npm run typecheck

e2e:
	npm run e2e

smoke:
	node scripts/smoke.mjs

dev:
	npm run dev

worker:
	npx wrangler dev --port 8787 --ip 127.0.0.1
