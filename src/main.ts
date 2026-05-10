import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

// Интерфейс настроек
interface ChatFormatterSettings {
    targetFolder: string;
    startMarker: string;
    endMarker: string;
}

const DEFAULT_SETTINGS: ChatFormatterSettings = {
    targetFolder: "Ответы ИИ",
    startMarker: "(((",
    endMarker: ")))"
}

export default class ChatFormatterPlugin extends Plugin {
    settings: ChatFormatterSettings;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new ChatFormatterSettingTab(this.app, this));

        this.addCommand({
            id: 'format-nested-callouts-copy',
            name: 'Оформить (создать копию)',
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                await this.formatChat(editor, view);
            }
        });

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                menu.addItem((item) => {
                    item
                        .setTitle('Оформить (копия)')
                        .setIcon('help-circle')
                        .onClick(() => {
                            this.formatChat(editor, view);
                        });
                });
            })
        );

        this.addRibbonIcon('help-circle', 'Оформить (копия)', (evt: MouseEvent) => {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (view && view.editor) {
                this.formatChat(view.editor, view);
            } else {
                new Notice('Пожалуйста, откройте заметку!');
            }
        });
    }

    async formatChat(editor: Editor, view: MarkdownView) {
        const currentFile = view.file;
        if (!currentFile) return;

        const targetFolder = this.settings.targetFolder.trim();
        if (!targetFolder) {
            new Notice("Укажите папку в настройках!");
            return;
        }

        const fullContent = editor.getValue();
        let yaml = "";
        let chatBody = fullContent;

        if (fullContent.trimStart().startsWith("---")) {
            const parts = fullContent.split(/^---/m);
            if (parts.length >= 3) {
                yaml = `---${parts[1]}---\n`;
                chatBody = parts.slice(2).join("---").trim();
            }
        }

        const startM = this.settings.startMarker.trim();
        const endM = this.settings.endMarker.trim();

        // Препроцессор для изоляции маркеров
        let safeBody = chatBody.split(startM).join(`\n${startM}\n`);
        safeBody = safeBody.split(endM).join(`\n${endM}\n`);

        const rawLines = safeBody.split(/\r?\n/);
        let finalOutputLines: string[] = [];
        let depth = 0;
        let needsTitle = false;

        for (let i = 0; i < rawLines.length; i++) {
            let line = rawLines[i];
            let trimmed = line.trim();

            if (!trimmed) {
                if (depth > 0) finalOutputLines.push("> ".repeat(depth).trimEnd());
                else finalOutputLines.push("");
                continue;
            }

            if (trimmed === startM) {
                depth++;
                needsTitle = true;
                continue;
            } 
            else if (trimmed === endM) {
                if (depth > 0) depth--;
                continue;
            }

            let prefix = "> ".repeat(depth);
            
            if (needsTitle) {
                let title = "";
                let body = "";
                
                // Умный поиск заголовка в склеенной строке
                let splitIndex = -1;
                for (let j = 1; j < trimmed.length; j++) {
                    if (trimmed[j] !== ' ' && trimmed[j] === trimmed[j].toUpperCase() && trimmed[j].match(/[А-ЯЁA-Z]/)) {
                        if (trimmed[j-1] === ' ') {
                            splitIndex = j;
                            break;
                        }
                    }
                }

                if (splitIndex !== -1 && splitIndex < 60) {
                    title = trimmed.substring(0, splitIndex).trim();
                    body = trimmed.substring(splitIndex).trim();
                } else {
                    title = trimmed.length < 60 ? trimmed : "Вопрос";
                    if (trimmed.length >= 60) body = trimmed;
                }

                // [!question]- делает блок оранжевым и свернутым
                finalOutputLines.push(`${prefix.slice(0, -2)}> [!question]- Ответ: ${title}`);
                if (body) finalOutputLines.push(`${prefix}${body}`);
                needsTitle = false;
            } else {
                finalOutputLines.push(`${prefix}${line}`);
            }
        }

        const finalOutput = yaml + (yaml ? "\n" : "") + finalOutputLines.join("\n");

        try {
            let folder = this.app.vault.getAbstractFileByPath(targetFolder);
            if (!folder) await this.app.vault.createFolder(targetFolder);

            let newPath = `${targetFolder}/${currentFile.basename}_formatted.${currentFile.extension}`;
            let counter = 1;
            while (this.app.vault.getAbstractFileByPath(newPath)) {
                newPath = `${targetFolder}/${currentFile.basename}_formatted_${counter}.${currentFile.extension}`;
                counter++;
            }

            await this.app.vault.create(newPath, finalOutput);
            new Notice(`Готово! Оранжевые блоки созданы в: ${newPath}`);
        } catch (err) {
            console.error(err);
            new Notice("Ошибка сохранения!");
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class ChatFormatterSettingTab extends PluginSettingTab {
    plugin: ChatFormatterPlugin;

    constructor(app: App, plugin: ChatFormatterPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();
        containerEl.createEl('h2', {text: 'Настройки Chat Formatter'});

        new Setting(containerEl)
            .setName('Папка для сохранения')
            .addText(text => text
                .setValue(this.plugin.settings.targetFolder)
                .onChange(async (value) => {
                    this.plugin.settings.targetFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Маркер начала')
            .addText(text => text
                .setValue(this.plugin.settings.startMarker)
                .onChange(async (value) => {
                    this.plugin.settings.startMarker = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Маркер конца')
            .addText(text => text
                .setValue(this.plugin.settings.endMarker)
                .onChange(async (value) => {
                    this.plugin.settings.endMarker = value;
                    await this.plugin.saveSettings();
                }));
    }
}