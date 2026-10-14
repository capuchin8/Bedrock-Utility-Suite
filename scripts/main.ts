import "./commands/impulse";
import "./commands/inventory";
import "./commands/item";
import "./ItemManager";
import "./dimensions";
import "./floatingText/floatingTextEntities";
import "./floatingText/floatingTextMenu";
import "./commands/testShop";
import "./shop/shopCommands";
import { registerShopEvents } from "./shop/shopCommands";
registerShopEvents();

// Core systems
import "./commands/busCommand";
import "./share/builtinShareables";
import "./permissions/ownerCommand";

// Player events (one listener for joins/leaves; modules below subscribe to it)
import "./events/playerEvents";
import "./events/newPlayers";
import "./events/eventCommands";
import "./combat/combatStore";
import "./rules/rulesStore";
import "./rules/rulesPrompt";

// Roles, name tags and chat
import "./roles/nameTag";
import "./roles/chat";

// Settings screen and its built-in sections
import "./settings/settingsCommand";
import "./settings/sections/rolesSection";
import "./settings/sections/roleDisplaySection";
import "./settings/sections/newPlayersSection";
import "./settings/sections/eventCommandsSection";
import "./interact/interactBlocks";
import "./settings/sections/interactSection";
import "./settings/sections/combatSection";
import "./settings/sections/rulesSection";
import "./settings/sections/permissionsSection";
import "./settings/sections/shareSection";

// Debug menu: stripped from production builds (see justfile dropLabels)
import "./debug/debugSection";

// Nicknames
import "./nicknames/nicknameSection";
import "./nicknames/nicknameCommand";

/*!
 *
 * Bedrock Utility Suite
 *
 * MIT License
 *
 * Copyright (c) 2026 Capuchin_
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */
