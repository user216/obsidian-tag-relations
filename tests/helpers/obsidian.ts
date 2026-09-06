/**
 * Stand-in for the `obsidian` module.
 *
 * The plugin only imports a handful of things from Obsidian at module scope;
 * this provides just enough for the pure logic under test to be bundled and
 * run under Node. Anything UI-shaped is a no-op — tests never touch it.
 */

export class TFile {
	path = "";
	basename = "";
	extension = "md";
}

export class TFolder {
	path = "";
}

export function getAllTags(cache: any): string[] | null {
	return cache?.tags?.map((hit: any) => hit.tag) ?? null;
}

export function normalizePath(path: string): string {
	return path;
}

export function setIcon(): void {}
export function setTooltip(): void {}

export function debounce<T extends (...args: any[]) => any>(fn: T): T & {
	cancel(): void;
} {
	const wrapped = ((...args: any[]) => fn(...args)) as T & { cancel(): void };
	wrapped.cancel = () => {};
	return wrapped;
}

class Stub {
	constructor(..._args: any[]) {}
}

export class Plugin extends Stub {}
export class ItemView extends Stub {}
export class PluginSettingTab extends Stub {}
export class Modal extends Stub {}
export class SuggestModal extends Stub {}
export class FuzzySuggestModal extends Stub {}
export class Notice extends Stub {}
export class Menu extends Stub {}
export class Setting extends Stub {}
export class WorkspaceLeaf extends Stub {}
export class App extends Stub {}
