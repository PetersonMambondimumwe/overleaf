# Overleaf release image + this repo's Clerk / Google sign-in changes.
#
# This is an *overlay*: the published release image already contains the
# compiled frontend, the Yarn PnP dependency tree and TeX Live, so only the
# handful of server files that changed are replaced. The build takes seconds.
#
# It lives at the repository root so that build platforms which default to
# `Dockerfile` (Dokploy, plain `docker build .`) work without extra settings.
#
# Bump OVERLEAF_RELEASE_TAG to pick up a new Overleaf release.
ARG OVERLEAF_RELEASE_TAG=latest
FROM sharelatex/sharelatex:${OVERLEAF_RELEASE_TAG}

WORKDIR /overleaf

COPY services/web/app/src/Features/Authentication/ClerkController.mjs \
     services/web/app/src/Features/Authentication/

COPY services/web/app/src/Features/AI/AiAssistController.mjs \
     services/web/app/src/Features/AI/

COPY services/web/app/src/Features/User/UserPagesController.mjs \
     services/web/app/src/Features/User/

COPY services/web/app/src/Features/User/UserController.mjs \
     services/web/app/src/Features/User/

COPY services/web/app/src/router.mjs \
     services/web/app/src/

COPY services/web/app/views/user/login-clerk.pug \
     services/web/app/views/user/

COPY services/web/app/views/project/ide-react.pug \
     services/web/app/views/project/

COPY services/web/public/js/ai-assist.js \
     services/web/public/js/

COPY services/web/config/settings.defaults.js \
     services/web/config/
