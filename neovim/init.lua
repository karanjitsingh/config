-- Check if Neovim is running in VSCode (optional, for VSCode extension)
if vim.g.vscode then
    -- VSCode extension setup (if any)
else
    -- Ordinary Neovim setup
end

-- Set leader key to Space
vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- Use system clipboard
vim.opt.clipboard = "unnamedplus"

-- Enable case-insensitive search
vim.opt.ignorecase = true

-- Enable smart case (case-sensitive only when search contains uppercase)
vim.opt.smartcase = true

-- Enable relative line numbers
vim.wo.relativenumber = true

-- Add command to insert UUID
vim.api.nvim_create_user_command('UUID', function()
    local uuid = vim.fn.system('uuidgen'):gsub('\n', ''):lower()
    vim.api.nvim_put({uuid}, '', false, true)
end, {})

-- Shift + { } while ignoring whitespace
vim.keymap.set('n', '}', function()
  vim.fn.search('^\\s*$', 'W')
--   vim.cmd('normal! $')
end, { noremap = true, silent = true })

vim.keymap.set('n', '{', function()
  vim.fn.search('^\\s*$', 'bW')
--   vim.cmd('normal! $')
end, { noremap = true, silent = true })

-- Print epoch timestamp in milliseconds for command NOW
vim.api.nvim_create_user_command('NOW', function()
    local now = vim.fn.localtime() * 1000
    vim.api.nvim_put({tostring(now)}, '', false, true)
end, {})

-- Disable auto adding comments on new line
vim.api.nvim_create_autocmd("FileType", {
  pattern = "*",
  callback = function()
    vim.opt_local.formatoptions:remove({ "o" })
  end,
})

-- Surround visual selection with a delimiter
-- Note: 's' normally deletes selection and enters insert mode (like 'c'). 'c' can still be used for that.
vim.keymap.set("v", "s", function()
    local ok, char = pcall(vim.fn.getcharstr)
    if not ok or char == "\27" then return "<Esc>" end
    
    local pairs = {
        ["("] = ")",
        ["["] = "]",
        ["{"] = "}",
        ["<"] = ">",
    }
    local right = pairs[char] or char
    local left = char
    
    return string.format("<Esc>`>a%s<Esc>`<i%s<Esc>", right, left)
end, { expr = true, noremap = true, desc = "Surround visual selection" })

-- Remove surrounding characters from visual selection if they match or are pairs
-- Will remain in visual selection after 
vim.keymap.set("v", "S", function()
    -- Save registers
    local z_reg = vim.fn.getreg('z')
    local z_type = vim.fn.getregtype('z')
    
    -- Yank visual selection into register z
    vim.cmd('normal! "zy')
    local text = vim.fn.getreg('z')
    
    local pairs = { ["("] = ")", ["["] = "]", ["{"] = "}", ["<"] = ">", ["'"] = "'", ['"'] = '"', ["`"] = "`" }
    local first = text:sub(1, 1)
    local last = text:sub(-1, -1)
    
    -- Check if first and last characters are the same or valid pairs
    if #text >= 2 and (first == last or pairs[first] == last) then
        local inner = text:sub(2, -2)

        -- Use byte-precise replacement via the visual marks
        local spos = vim.fn.getpos("'<")
        local epos = vim.fn.getpos("'>")
        local buf = vim.api.nvim_get_current_buf()
        local row = spos[2] - 1  -- 0-indexed
        local start_col = math.min(spos[3], epos[3]) - 1  -- 0-indexed
        local end_col = math.max(spos[3], epos[3])        -- 0-indexed exclusive

        local ok = pcall(vim.api.nvim_buf_set_text, buf, row, start_col, row, end_col, { inner })
        if not ok then
            -- Fallback: use register-based replacement
            vim.fn.setreg('z', inner, vim.fn.getregtype('z'))
            vim.cmd('normal! gv"_d"zP`[v`]')
        elseif #inner > 0 then
            vim.fn.cursor(spos[2], start_col + 1)
            vim.cmd("normal! v")
            vim.fn.cursor(spos[2], start_col + vim.fn.strlen(inner))
        end
    else
        -- If no valid delimiters found, just restore visual selection
        vim.cmd('normal! gv')
    end
    
    -- Restore register z
    vim.fn.setreg('z', z_reg, z_type)
end, { noremap = true, desc = "Remove surrounding characters" })




-- GIT  integrations

-- Bootstrap lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
  local lazyrepo = "https://github.com/folke/lazy.nvim.git"
  local out = vim.fn.system({ "git", "clone", "--filter=blob:none", "--branch=stable", lazyrepo, lazypath })
  if vim.v.shell_error ~= 0 then
    vim.api.nvim_echo({
      { "Failed to clone lazy.nvim:\n", "ErrorMsg" },
      { out, "WarningMsg" },
      { "\nPress any key to exit...", "None" },
    }, true, {})
    vim.fn.getchar()
    os.exit(1)
  end
end
vim.opt.rtp:prepend(lazypath)

require("lazy").setup({
  -- ... your other plugins ...

  -- 1. For side-by-side diffs
  {
    "sindrets/diffview.nvim",
    dependencies = { "nvim-tree/nvim-web-devicons" }, -- optional, for file icons
    cmd = { "DiffviewOpen", "DiffviewClose", "DiffviewToggleFiles" },
  },

  -- 2. For inline gutter diffs
  {
    "lewis6991/gitsigns.nvim",
    config = function()
      require("gitsigns").setup()
    end,
  },

  -- 3. Telescope fuzzy finder
  {
    "nvim-telescope/telescope.nvim",
    tag = "0.1.8",
    dependencies = { "nvim-lua/plenary.nvim" },
    config = function()
      local builtin = require("telescope.builtin")
      vim.keymap.set("n", "<leader>ff", builtin.find_files, { desc = "Telescope Find Files" })
      vim.keymap.set("n", "<leader>fg", builtin.live_grep, { desc = "Telescope Live Grep" })
      vim.keymap.set("n", "<leader>fb", builtin.buffers, { desc = "Telescope Buffers" })
      vim.keymap.set("n", "<leader>fh", builtin.help_tags, { desc = "Telescope Help Tags" })
    end,
  },

  -- 4. Catppuccin theme
  {
    "catppuccin/nvim",
    name = "catppuccin",
    priority = 1000,
    config = function()
      vim.cmd.colorscheme("catppuccin")
    end,
  },
})
