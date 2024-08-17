#!bash
#
# Setup the Google Cloud SDK

: ${GOOGLE_CLOUD_SDK:="$HOME/bin/google-cloud-sdk"}

# The next line updates PATH for the Google Cloud SDK.
if [ -f "${GOOGLE_CLOUD_SDK}/path.bash.inc" ]; then . "${GOOGLE_CLOUD_SDK}/path.bash.inc"; fi

# The next line enables shell command completion for gcloud.
if [ -f "${GOOGLE_CLOUD_SDK}/completion.bash.inc" ]; then . "${GOOGLE_CLOUD_SDK}/completion.bash.inc"; fi
