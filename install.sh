#!/bin/bash
set -e

# --- Configuration & Colors ---
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# --- Banner ---
echo -e "${BLUE}${BOLD}"
echo "  🍎 OpenBot Installer"
echo "  ------------------------------------------"
echo -e "${NC}"

# --- Function: Install Node.js ---
install_node() {
    OS="$(uname -s)"
    case "${OS}" in
        Darwin*)
            echo "🍎 macOS detected. Checking for Homebrew..."
            if ! command -v brew >/dev/null 2>&1; then
                echo "🍺 Homebrew not found. Installing Homebrew first (this may take a minute)..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                # Add brew to path for the current session
                if [[ -d "/opt/homebrew/bin" ]]; then
                    eval "$(/opt/homebrew/bin/brew shellenv)"
                elif [[ -d "/usr/local/bin" ]]; then
                    eval "$(/usr/local/bin/brew shellenv)"
                fi
            fi
            echo "📦 Installing Node.js via Homebrew..."
            brew install node
            ;;
        Linux*)
            if command -v apt-get >/dev/null 2>&1; then
                echo "🐧 Debian/Ubuntu detected. Installing Node.js..."
                sudo apt-get update
                sudo apt-get install -y ca-certificates curl gnupg
                sudo mkdir -p /etc/apt/keyrings
                curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
                NODE_MAJOR=20
                echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
                sudo apt-get update
                sudo apt-get install nodejs -y
            elif command -v dnf >/dev/null 2>&1; then
                echo "🐧 RHEL/Fedora detected. Installing Node.js..."
                sudo dnf install -y nodejs
            else
                echo -e "${RED}❌ Unsupported Linux distribution.${NC} Please install Node.js manually: https://nodejs.org/"
                exit 1
            fi
            ;;
        *)
            echo -e "${RED}❌ Unknown Operating System.${NC} Please install Node.js manually: https://nodejs.org/"
            exit 1
            ;;
    esac
}

# --- 1. Check for Node.js ---
echo "🔍 Checking dependencies..."
if ! command -v node >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Node.js is missing!${NC}"
    echo -n "Would you like me to install Node.js for you? (y/n) "
    read -r REPLY
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        install_node
    else
        echo -e "${RED}❌ Installation cancelled.${NC} Node.js is required to run OpenBot."
        exit 1
    fi
fi

# Ensure npm is also available
if ! command -v npm >/dev/null 2>&1; then
    echo -e "${RED}❌ NPM is not found even though Node.js is installed.${NC} Please check your Node.js installation."
    exit 1
fi

# --- 2. Global Installation ---
echo -e "📦 Installing ${BOLD}openbot${NC} and ${BOLD}openbot-web${NC} globally..."

# Check if we have write access to the global node_modules directory
NPM_GLOBAL_PREFIX=$(npm config get prefix)
if [[ -w "$NPM_GLOBAL_PREFIX/lib/node_modules" ]] || [[ "$EUID" -eq 0 ]]; then
    npm install -g openbot@latest openbot-web@latest
else
    echo -e "${YELLOW}⚠️  Permission denied for global install. Trying with sudo...${NC}"
    sudo npm install -g openbot@latest openbot-web@latest
fi

# --- 3. Final Instructions & Launch ---
echo -e "\n✅ ${GREEN}${BOLD}Installation complete!${NC}"
echo "------------------------------------------"
echo -e "Commands installed:"
echo -e "  - ${BOLD}openbot server${NC} (The AI engine)"
echo -e "  - ${BOLD}openbot-web${NC}    (The dashboard)"
echo "------------------------------------------"

echo -e "\n🚀 Starting OpenBot and launching your dashboard..."
echo -e "(Press ${BOLD}Ctrl+C${NC} to stop both services at any time)\n"

# Use npx -y to avoid prompting for concurrently installation
npx -y concurrently \
  --kill-others \
  --names "SERVER,WEBUI" \
  --prefix "{name}" \
  --prefix-colors "blue.bold,green.bold" \
  "openbot server" \
  "openbot-web"
