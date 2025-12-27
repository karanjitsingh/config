-- Check if Neovim is running in VSCode (optional, for VSCode extension)
if vim.g.vscode then
    -- VSCode extension setup (if any)
else
    -- Ordinary Neovim setup
end

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