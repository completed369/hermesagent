FROM node:22-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46

ARG PI_VERSION=0.83.0

USER root
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system --add safe.directory /workspace

# Pi's official quickstart recommends --ignore-scripts. Pin the version so the
# engineering environment cannot silently change underneath a release cycle.
RUN npm install --global --ignore-scripts "@earendil-works/pi-coding-agent@${PI_VERSION}" \
  && npm cache clean --force

RUN mkdir -p /home/node/.pi/agent /workspace \
  && chown -R node:node /home/node/.pi

ENV HOME=/home/node \
    PI_SKIP_VERSION_CHECK=1
WORKDIR /workspace
USER node

ENTRYPOINT ["pi"]
