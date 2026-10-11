#!/usr/bin/env bash
#
# Creatine installer.
#
# Installs the CLI from the GitHub repository into ~/.creatine:
#   1. clone (or update) the repository into ~/.creatine/app
#   2. install its dependencies and run it with bun
#   3. write a `creatine` launcher into ~/.creatine/bin
#   4. add ~/.creatine/bin to PATH
#   5. print the success message
#
# Examples:
#   curl -fsSL https://raw.githubusercontent.com/reaperblitz/Creatine-AI/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/reaperblitz/Creatine-AI/main/install.sh | bash -s -- --no-modify-path
#
set -euo pipefail

APP_NAME="creatine"
REPO_URL="${CREATINE_REPO_URL:-https://github.com/reaperblitz/Creatine-AI.git}"

MUTED='\033[0;2m'
RED='\033[0;31m'
ORANGE='\033[38;5;214m'
NC='\033[0m' # No Color

info() { echo -e "${ORANGE}$1${NC}"; }
detail() { echo -e "${MUTED}$1${NC}"; }
fail() {
    echo -e "${RED}$1${NC}" >&2
    exit 1
}

usage() {
    cat <<EOF
Creatine Installer (bun source install)

Clones the repository into ~/.creatine/app, installs its dependencies with bun,
writes a '${APP_NAME}' launcher into ~/.creatine/bin and adds it to PATH.

Usage: install.sh [options]

Options:
    -h, --help          Display this help message
    --no-modify-path    Don't modify shell config files, only print the steps
    --service           Also install a systemd user service so the server runs headless and
                        survives a reboot (recommended on a VPS)

Environment:
    CREATINE_REPO_URL   Repository to install from (default: ${REPO_URL})

Examples:
    curl -fsSL https://raw.githubusercontent.com/reaperblitz/Creatine-AI/main/install.sh | bash
EOF
}

modify_path=true
install_service=false

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        --no-modify-path)
            modify_path=false
            shift
            ;;
        --service)
            install_service=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}" >&2
            usage >&2
            exit 1
            ;;
    esac
done

# 1. Prerequisites.
#
# A fresh VPS image usually has no bun and often no curl or git. This script used to stop here,
# print a bun.sh URL, and exit - a dead end for exactly the audience it is for. Bootstrap the
# pieces it needs instead, and only refuse when the machine genuinely cannot provide them.

SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
fi

# `sudo -n` everywhere below. This script is normally piped into `bash` over a non-interactive
# shell, where a plain `sudo` would sit on an invisible password prompt and look like a hang.
# With -n it fails immediately and the message below says what to do.
pkg_install() {
    if command -v apt-get >/dev/null 2>&1; then
        $SUDO -n apt-get update -qq >/dev/null 2>&1 || true
        DEBIAN_FRONTEND=noninteractive $SUDO -n apt-get install -y -qq "$@"
    elif command -v dnf >/dev/null 2>&1; then
        $SUDO -n dnf install -y -q "$@"
    elif command -v yum >/dev/null 2>&1; then
        $SUDO -n yum install -y -q "$@"
    elif command -v apk >/dev/null 2>&1; then
        $SUDO -n apk add --no-cache "$@"
    else
        return 1
    fi
}

if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    info "Installing curl..."
    pkg_install curl ca-certificates || fail "Could not install curl. Install it, then re-run this script."
fi

# git is optional: the archive fallback below covers its absence. ca-certificates is not, because
# every https fetch below fails with a confusing TLS error without it.
if ! command -v git >/dev/null 2>&1; then
    info "Installing git..."
    pkg_install git || true
fi

if ! command -v bun >/dev/null 2>&1; then
    info "Bun is not installed. Installing it now..."
    # The bun installer unpacks a zip with the `unzip` binary and fails with a bare "unzip is
    # required" when it is absent, so make sure it is there first.
    if ! command -v unzip >/dev/null 2>&1; then
        info "Installing unzip..."
        pkg_install unzip \
            || fail "Could not install unzip, which the bun installer needs. Run this script as root, grant passwordless sudo, or install unzip and re-run."
    fi
    fetch() {
        if command -v curl >/dev/null 2>&1; then curl -fsSL "$1"; else wget -qO- "$1"; fi
    }
    fetch https://bun.sh/install | bash || fail "Failed to install bun. Install it manually, then re-run this script."
fi

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
command -v bun >/dev/null 2>&1 || fail "bun is still not on PATH after installation. Add $BUN_INSTALL/bin to PATH and re-run."
detail "Using bun $(bun --version) at $(command -v bun)"

# 2. Set up installation paths
CREATINE_HOME="$HOME/.creatine"
APP_DIR="$CREATINE_HOME/app"
BIN_DIR="$CREATINE_HOME/bin"
PKG_DIR="$APP_DIR/packages/opencode"
ENTRY_POINT="src/index.ts"
LAUNCHER="$BIN_DIR/$APP_NAME"

mkdir -p "$BIN_DIR"

echo -e "\n${MUTED}Installing ${NC}${APP_NAME} ${MUTED}from source using Bun...${NC}"

# 3. Download or Clone Source Code into ~/.creatine/app
if [ -d "$APP_DIR/.git" ]; then
    info "Updating existing source repository..."
    # "bun install" rewrites bun.lock in the checkout, and a rebase configured for
    # the branch makes "git pull" refuse those changes. Sync to the remote tip
    # instead, which keeps this script re-runnable.
    git -C "$APP_DIR" fetch --quiet --depth 1 origin || fail "Failed to fetch $REPO_URL"
    git -C "$APP_DIR" reset --quiet --hard FETCH_HEAD || fail "Failed to update $APP_DIR. Delete it and run this script again: rm -rf \"$APP_DIR\""
elif command -v git >/dev/null 2>&1; then
    if [ -e "$APP_DIR" ]; then
        info "Removing existing directory that is not a git checkout..."
        rm -rf "$APP_DIR"
    fi
    info "Cloning GitHub repository..."
    git clone --quiet --depth 1 "$REPO_URL" "$APP_DIR" || fail "Failed to clone $REPO_URL"
else
    info "Git not found. Downloading repository archive..."
    if ! command -v curl >/dev/null 2>&1; then
        fail "Git or curl is required to install Creatine."
    fi
    case "${REPO_URL%.git}" in
        https://github.com/*) ;;
        *) fail "Git is required to install from a non GitHub repository ($REPO_URL)" ;;
    esac
    tmp_dir=$(mktemp -d)
    trap 'rm -rf "$tmp_dir"' EXIT
    curl -fsSL "${REPO_URL%.git}/archive/HEAD.tar.gz" | tar -xz -C "$tmp_dir" --strip-components=1 || fail "Failed to download the repository archive"
    if [ -e "$APP_DIR" ]; then
        rm -rf "$APP_DIR"
    fi
    mkdir -p "$APP_DIR"
    cp -R "$tmp_dir/." "$APP_DIR/"
fi

if [ ! -f "$PKG_DIR/$ENTRY_POINT" ]; then
    fail "Expected $PKG_DIR/$ENTRY_POINT to exist. The repository layout changed, so this installer needs to be updated."
fi

# 4. Install Dependencies with Bun
info "Installing dependencies with bun..."
cd "$APP_DIR"
# HUSKY=0 keeps the git hooks of the checkout untouched (and avoids a failure
# when the sources came from the archive instead of git).
if ! HUSKY=0 bun install; then
    info "Retrying install with the minimum release age guard disabled..."
    HUSKY=0 bun install --minimum-release-age=0 || fail "Failed to run 'bun install' in $APP_DIR. If a native module failed to build, install a C/C++ toolchain (python3, make, g++) and run this script again."
fi

# 5. Write the launcher into ~/.creatine/bin
info "Writing launcher to $LAUNCHER..."
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
# Generated by install.sh. Runs the Creatine CLI from ~/.creatine/app with bun.
exec bun run --cwd "$PKG_DIR" "$ENTRY_POINT" "\$@"
EOF
chmod 755 "$LAUNCHER"

# 6. Verify the launcher before touching PATH
info "Verifying installation..."
if ! version_output="$("$LAUNCHER" --version 2>&1)"; then
    echo -e "${RED}Verification failed. '$LAUNCHER --version' printed:${NC}" >&2
    echo "$version_output" >&2
    fail "PATH was left unchanged. Fix the errors above and run '$LAUNCHER --version' manually."
fi

# 7. Add ~/.creatine/bin to the shell PATH
add_to_path() {
    local config_file=$1
    local line=$2

    if grep -Fqx "$line" "$config_file" 2>/dev/null; then
        detail "$config_file already adds $BIN_DIR to PATH."
        return 0
    fi
    if [ -e "$config_file" ] && [ ! -w "$config_file" ]; then
        info "Cannot write to $config_file. Add the directory manually:"
        echo "  $line"
        return 0
    fi
    mkdir -p "$(dirname "$config_file")"
    printf '\n# creatine\n%s\n' "$line" >> "$config_file"
    detail "Added $BIN_DIR to PATH in $config_file"
}

if [ "$modify_path" = true ]; then
    xdg_config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
    current_shell=$(basename "${SHELL:-}")
    if [ -z "$current_shell" ]; then
        if [ -n "${FISH_VERSION:-}" ]; then
            current_shell="fish"
        elif [ -n "${ZSH_VERSION:-}" ]; then
            current_shell="zsh"
        else
            current_shell="bash"
        fi
    fi

    if [ "$current_shell" = "csh" ] || [ "$current_shell" = "tcsh" ]; then
        info "Cannot update the config of $current_shell automatically. Add the directory manually:"
        echo "  setenv PATH \"$BIN_DIR:\$PATH\""
    else
        case "$current_shell" in
            fish)
                config_files=("$xdg_config_home/fish/config.fish")
                ;;
            zsh)
                config_files=("$HOME/.zshrc" "${ZDOTDIR:-$HOME}/.zshenv" "$xdg_config_home/zsh/.zshrc")
                ;;
            bash)
                config_files=("$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$xdg_config_home/bash/.bashrc")
                ;;
            ash|sh|dash)
                config_files=("$HOME/.profile" "$HOME/.ashrc")
                ;;
            *)
                config_files=("$HOME/.bashrc" "$HOME/.profile")
                ;;
        esac

        # Fall back to the primary config file of the shell when none exist yet.
        config_file="${config_files[0]}"
        for file in "${config_files[@]}"; do
            if [ -f "$file" ]; then
                config_file="$file"
                break
            fi
        done

        if [ "$current_shell" = "fish" ]; then
            add_to_path "$config_file" "fish_add_path \"$BIN_DIR\""
        else
            add_to_path "$config_file" "export PATH=\"$BIN_DIR:\$PATH\""
        fi
    fi
else
    detail "Skipping PATH modification (--no-modify-path)."
    echo -e "  Add it manually: ${ORANGE}export PATH=\"$BIN_DIR:\$PATH\"${NC}"
fi

# 8. Optional systemd service
#
# On a VPS the usual reason for installing is that the agent keeps working while nobody is SSHed
# in. A foreground process dies with the terminal, so this registers a user-level unit with
# lingering enabled - without linger, systemd stops the unit at logout and the "always on" claim
# is quietly false.
if [ "$install_service" = true ]; then
    if ! command -v systemctl >/dev/null 2>&1; then
        fail "--service needs systemd, which was not found on this system."
    fi

    SERVICE_DIR="$HOME/.config/systemd/user"
    SERVICE_FILE="$SERVICE_DIR/$APP_NAME.service"
    # Bound to all interfaces by default because the point of a VPS is reaching it from
    # elsewhere. That is only safe with a password: `serve` leaves the server open when
    # CREATINE_SERVER_PASSWORD is unset, so generate one here rather than shipping a wide-open
    # agent with filesystem access. Verified: with no password, /api/session answers 200 to an
    # anonymous request.
    SERVICE_HOST="${CREATINE_HOST:-0.0.0.0}"
    SERVICE_PORT="${CREATINE_PORT:-4096}"

    # An EnvironmentFile rather than an inline Environment= line, so the secret is not visible in
    # `systemctl cat` or the unit file's world-readable permissions.
    ENV_FILE="$HOME/.config/creatine/server.env"
    if [ -n "${CREATINE_SERVER_PASSWORD:-}" ]; then
        SERVER_PASSWORD="$CREATINE_SERVER_PASSWORD"
        detail "Using CREATINE_SERVER_PASSWORD from the environment."
    elif [ -f "$ENV_FILE" ]; then
        # Keep the password across re-runs; regenerating it would lock out anything already using it.
        detail "Reusing the existing password in $ENV_FILE"
    else
        SERVER_PASSWORD="$(head -c 32 /dev/urandom | base64 | tr -d '\n/+=' | head -c 40)"
    fi

    mkdir -p "$SERVICE_DIR" "$(dirname "$ENV_FILE")"
    umask 077
    printf 'CREATINE_SERVER_PASSWORD=%s\n' "$SERVER_PASSWORD" > "$ENV_FILE"
    umask 022

    detail "Writing $SERVICE_FILE"
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Creatine server
After=network-online.target

[Service]
Type=simple
ExecStart=$LAUNCHER serve --hostname $SERVICE_HOST --port $SERVICE_PORT
EnvironmentFile=$ENV_FILE
Environment=HOME=$HOME
Environment=BUN_INSTALL=$BUN_INSTALL
Environment=PATH=$BUN_INSTALL/bin:$BIN_DIR:/usr/local/bin:/usr/bin:/bin
WorkingDirectory=$HOME
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

    systemctl --user daemon-reload || fail "Failed to reload the systemd user manager."
    # enable + restart, not `enable --now`: `--now` is a no-op when the unit is already active, so
    # re-running this script would leave the previously running process alive with the old unit's
    # environment - including a missing password. Restart is idempotent and always picks up the
    # unit just written.
    systemctl --user enable "$APP_NAME.service" || fail "Failed to enable $APP_NAME.service."
    systemctl --user restart "$APP_NAME.service" || fail "Failed to start $APP_NAME.service."

    # Keep the unit alive after logout; without this systemd tears the session down on exit.
    if command -v loginctl >/dev/null 2>&1; then
        loginctl enable-linger "$(id -un)" >/dev/null 2>&1 \
            && detail "Enabled lingering, so the service keeps running after you log out." \
            || info "Could not enable lingering automatically. Run: sudo loginctl enable-linger $(id -un)"
    fi

    sleep 2
    if systemctl --user is-active --quiet "$APP_NAME.service"; then
        detail "Service is active: systemctl --user status $APP_NAME"
    else
        info "The service did not report active. Check: systemctl --user status $APP_NAME"
    fi

    if [ "$SERVICE_HOST" = "0.0.0.0" ]; then
        echo -e ""
        info "The server is listening on $SERVICE_HOST:$SERVICE_PORT, password-protected."
        echo -e "  Password: ${ORANGE}cat $ENV_FILE${NC}"
        echo -e "  ${MUTED}Open that port in your provider's firewall, or SSH in and port-forward it.${NC}"
    fi
fi

# 9. Display Success Message
echo -e ""
echo -e "${MUTED}                    ${NC}         ▄     "
echo -e "${MUTED}▄▄▄█ █▀▀█ █▀▀▀ █▀▀█ ${NC}▀█▀ ▀█▀ █▀▀▄ █▀▀▀"
echo -e "${MUTED}█    █ ▀▀ █▀▀  █▀▀█ ${NC}█   █   █  █ █▀▀ "
echo -e "${MUTED}▀▄▄▄ ▀ ▀▀ ▀▀▀▀ ▀  ▀ ${NC}▀   ▀▀▀ ▀  ▀ ▀▀▀▀"
echo -e ""
echo -e "${MUTED}Creatine installed successfully from source!${NC}"
echo -e ""
echo -e "  source   ${MUTED}$APP_DIR${NC}"
echo -e "  launcher ${MUTED}$LAUNCHER${NC}"
echo -e "  version  ${MUTED}$version_output${NC}"
echo -e ""
echo -e "  ${MUTED}Restart your terminal so ${APP_NAME} picks up the new PATH.${NC}"
echo -e ""
echo -e "  ${MUTED}cd <project>${NC}     ${MUTED}# Open project directory${NC}"
echo -e "  ${MUTED}${APP_NAME}${NC}          ${MUTED}# Run command${NC}"
echo -e "  ${MUTED}${APP_NAME} --version${NC}  ${MUTED}# Check the installation${NC}"
echo -e ""
echo -e "  ${MUTED}Re-run this script to update. To uninstall:${NC}"
echo -e "  ${MUTED}rm -rf \"$CREATINE_HOME\"${NC}"
echo -e ""
