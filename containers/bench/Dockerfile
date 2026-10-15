# The Bench image: what every repo's snapshot starts from before Forkin clones and installs it.
# The donor image ships the shim that @cloudflare/sandbox's Files API runs; keep its tag equal to
# the installed @cloudflare/sandbox version.
ARG SANDBOX_TOOLS_IMAGE=docker.io/cloudflare/sandbox:1.0.1
FROM ${SANDBOX_TOOLS_IMAGE} AS sandbox-tools

FROM node:24-trixie-slim
COPY --from=sandbox-tools /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates git python3 make g++ coreutils \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@11.19.0 \
 && corepack enable \
 && mkdir /workspace
CMD ["sleep", "infinity"]
