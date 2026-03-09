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
        vim.fn.setreg('z', inner, vim.fn.getregtype('z'))
        
        -- Delete selection (without clobbering unnamed register) and paste inner text, then reselect it
        vim.cmd('normal! gv"_d"zP`[v`]')
    else
        -- If no valid delimiters found, just restore visual selection
        vim.cmd('normal! gv')
    end
    
    -- Restore register z
    vim.fn.setreg('z', z_reg, z_type)
end, { noremap = true, desc = "Remove surrounding characters" })