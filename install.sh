#!/usr/bin/env bash
set -euo pipefail

APP=creatine

MUTED='\033[0;2m'
RED='\033[0;31m'
ORANGE='\033[38;5;214m'
NC='\033[0m' # No Color

usage() {
    cat <<EOF
Creatine Installer (Bun Source Mode)

Usage: install.sh [options]

Options:
    -h, --help          Display this help message
    --no-modify-path    Don't modify shell config files (.zshrc, .bashrc, etc.)

Examples:
    curl -fsSL https://creatine.puter.site/install.sh | bash
EOF
}

no_modify_path=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        --no-modify-path)
            no_modify_path=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# 1. Check for Bun Requirement
if ! command -v bun >/dev/null 2>&1; then
    echo -e "${RED}Error: Bun is required to install Creatine from source.${NC}"
    echo -e "Please install Bun first: ${ORANGE}curl -fsSL https://bun.sh/install | bash${NC}"
    exit 1
fi

# Set up installation paths
CREATINE_HOME="$HOME/.creatine"
APP_DIR="$CREATINE_HOME/app"
BIN_DIR="$CREATINE_HOME/bin"

mkdir -p "$BIN_DIR"

echo -e "\n${MUTED}Installing ${NC}creatine ${MUTED}from source using Bun...${NC}"

# 2. Download or Clone Source Code into ~/.creatine/app
if command -v git >/dev/null 2>&1; then
    if [ -d "$APP_DIR/.git" ]; then
        echo -e "${ORANGE}Updating existing source repository...${NC}"
        git -C "$APP_DIR" pull --quiet
    else
        echo -e "${ORANGE}Cloning GitHub repository...${NC}"
        rm -rf "$APP_DIR"
        git clone --quiet https://github.com/reaperblitz/Creatine-AI.git "$APP_DIR"
    fi
else
    echo -e "${ORANGE}Git not found. Downloading repository archive...${NC}"
    tmp_dir=$(mktemp -d)
    trap 'rm -rf "$tmp_dir"' EXIT

    curl -fsSL "https://github.com/reaperblitz/Creatine-AI/archive/refs/heads/main.tar.gz" | tar -xz -C "$tmp_dir"
    extracted_folder=$(find "$tmp_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)

    rm -rf "$APP_DIR"
    mkdir -p "$CREATINE_HOME"
    mv "$extracted_folder" "$APP_DIR"
fi

# 3. Install Dependencies & Build Binary
echo -e "${ORANGE}Installing dependencies with bun...${NC}"
cd "$APP_DIR"
bun install --silent

entry_point=""
if [ -f "src/index.ts" ]; then
    entry_point="src/index.ts"
elif [ -f "index.ts" ]; then
    entry_point="index.ts"
elif [ -f "src/cli.ts" ]; then
    entry_point="src/cli.ts"
fi

if [ -n "$entry_point" ]; then
    echo -e "${ORANGE}Compiling binary with bun...${NC}"
    bun build --compile --minify "$entry_point" --outfile "$BIN_DIR/creatine"
    chmod 755 "$BIN_DIR/creatine"
else
    echo -e "${ORANGE}Creating wrapper script...${NC}"
    cat <<'EOF' > "$BIN_DIR/creatine"
#!/usr/bin/env bash
bun run "$HOME/.creatine/app/src/index.ts" "$@"
EOF
    chmod 755 "$BIN_DIR/creatine"
fi

# 4. Add ~/.creatine/bin to User Shell PATH
add_to_path() {
    local config_file=$1
    local command=$2

    if grep -Fxq "$command" "$config_file" 2>/dev/null; then
        echo -e "${MUTED}Directory already in $config_file, skipping.${NC}"
    elif [[ -w $config_file ]]; then
        echo -e "\n# creatine" >> "$config_file"
        echo "$command" >> "$config_file"
        echo -e "${MUTED}Successfully added ${NC}creatine ${MUTED}to \$PATH in ${NC}$config_file"
    else
        echo -e "${ORANGE}Manually add the directory to $config_file:${NC}"
        echo -e "  $command"
    fi
}

if [[ "$no_modify_path" != "true" ]]; then
    XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}
    current_shell=$(basename "${SHELL:-bash}")

    case $current_shell in
        fish)
            config_files="$HOME/.config/fish/config.fish"
        ;;
        zsh)
            config_files="${ZDOTDIR:-$HOME}/.zshrc ${ZDOTDIR:-$HOME}/.zshenv $XDG_CONFIG_HOME/zsh/.zshrc"
        ;;
        bash)
            config_files="$HOME/.bashrc $HOME/.bash_profile $HOME/.profile $XDG_CONFIG_HOME/bash/.bashrc"
        ;;
        ash|sh)
            config_files="$HOME/.ashrc $HOME/.profile /etc/profile"
        ;;
        *)
            config_files="$HOME/.bashrc $HOME/.bash_profile"
        ;;
    esac

    config_file=""
    for file in $config_files; do
        if [[ -f $file ]]; then
            config_file=$file
            break
        fi
    done

    if [[ -z $config_file ]]; then
        echo -e "${ORANGE}No config file found for $current_shell. Manually add to PATH:${NC}"
        echo -e "  export PATH=\"$BIN_DIR:\$PATH\""
    elif [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        case $current_shell in
            fish)
                add_to_path "$config_file" "fish_add_path $BIN_DIR"
            ;;
            *)
                add_to_path "$config_file" "export PATH=\"$BIN_DIR:\$PATH\""
            ;;
        esac
    fi
fi

if [ -n "${GITHUB_ACTIONS-}" ] && [ "${GITHUB_ACTIONS}" == "true" ]; then
    echo "$BIN_DIR" >> "$GITHUB_PATH"
    echo -e "${MUTED}Added $BIN_DIR to \$GITHUB_PATH${NC}"
fi

# Display Success ASCII & Output
echo -e ""
echo -e "${MUTED}                    ${NC}         ▄     "
echo -e "${MUTED}▄▄▄█ █▀▀█ █▀▀▀ █▀▀█ ${NC}▀█▀ ▀█▀ █▀▀▄ █▀▀▀"
echo -e "${MUTED}█    █ ▀▀ █▀▀  █▀▀█ ${NC}█   █   █  █ █▀▀ "
echo -e "${MUTED}▀▄▄▄ ▀ ▀▀ ▀▀▀▀ ▀  ▀ ${NC}▀   ▀▀▀ ▀  ▀ ▀▀▀▀"
echo -e ""
echo -e "${MUTED}Creatine installed successfully from source!${NC}"
echo -e ""
echo -e "cd <project>  ${MUTED}# Open project directory${NC}"
echo -e "creatine      ${MUTED}# Run command${NC}"
echo -e ""