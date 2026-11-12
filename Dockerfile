# Overleaf release image + this repo's Clerk, AI, branding & TeX Live packages.
#
# It lives at the repository root so that build platforms which default to
# `Dockerfile` (Dokploy, plain `docker build .`) work without extra settings.
#
# Bump OVERLEAF_RELEASE_TAG to pick up a new Overleaf release.
ARG OVERLEAF_RELEASE_TAG=latest
FROM sharelatex/sharelatex:${OVERLEAF_RELEASE_TAG}

WORKDIR /overleaf

# TeX Live packages: installs academic collections (booktabs, multirow,
# manyfoot, algorithmicx, Springer Nature, IEEE, ACM, mathscience, etc.).
# Pass TEXLIVE_PROFILE=full if scheme-full (~5 GB) is explicitly required.
ARG TEXLIVE_PROFILE=academic
COPY bin/install-texlive-packages.sh /overleaf/bin/
RUN chmod +x /overleaf/bin/install-texlive-packages.sh && \
    /overleaf/bin/install-texlive-packages.sh "${TEXLIVE_PROFILE}"

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

COPY services/web/app/views/layout/thin-footer.pug \
     services/web/app/views/layout/

COPY services/web/public/js/ai-assist.js \
     services/web/public/js/

COPY services/web/config/settings.defaults.js \
     services/web/config/

COPY services/web/app/src/Features/Email/emailStyles.mjs \
     services/web/app/src/Features/Email/

COPY services/web/app/src/Features/Email/EmailBuilder.mjs \
     services/web/app/src/Features/Email/

COPY services/web/app/src/Features/Email/EmailSender.mjs \
     services/web/app/src/Features/Email/

COPY services/web/app/src/Features/Email/SpamSafe.mjs \
     services/web/app/src/Features/Email/

COPY services/web/app/src/Features/Email/Layouts/BaseEmailLayout.mjs \
     services/web/app/src/Features/Email/Layouts/

COPY services/web/app/src/Features/Collaborators/CollaboratorsEmailHandler.mjs \
     services/web/app/src/Features/Collaborators/CollaboratorsInviteHandler.mjs \
     services/web/app/src/Features/Collaborators/

COPY server-ce/config/settings.js \
     /etc/overleaf/settings.js

RUN if [ -d /etc/sharelatex ]; then cp /etc/overleaf/settings.js /etc/sharelatex/settings.js; fi

