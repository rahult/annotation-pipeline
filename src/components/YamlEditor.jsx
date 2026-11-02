import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, temporarilySetTabFocusMode } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, foldGutter, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { yaml } from '@codemirror/lang-yaml';
import { tags } from '@lezer/highlight';

const yamlHighlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.attributeName], color: '#007b7b' },
  { tag: [tags.string, tags.atom], color: '#713a83' },
  { tag: [tags.number, tags.bool, tags.null], color: '#a55b25' },
  { tag: tags.comment, color: '#81909a', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.separator, tags.operator], color: '#687d85' },
]);

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#ffffff', color: '#172325', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', fontSize: '13px', lineHeight: '1.65' },
  '.cm-content': { padding: '14px 0', caretColor: '#007c7d' },
  '.cm-line': { padding: '0 16px 0 10px' },
  '.cm-gutters': { backgroundColor: '#fbfcfd', color: '#82909a', borderRight: '1px solid #edf1f2' },
  '.cm-gutterElement': { paddingLeft: '8px', paddingRight: '8px' },
  '.cm-activeLineGutter': { color: '#007c7d', backgroundColor: '#edf8f6' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#dcefeb' },
  '.cm-cursor': { borderLeftColor: '#007c7d' },
  '.cm-foldPlaceholder': { backgroundColor: '#eef4f4', border: '1px solid #dce5e8', color: '#60747e' },
});

export default function YamlEditor({ value, onChange, onRun, onValidate, onSave, onReady, onCursorChange }) {
  const mountRef = useRef(null);
  const viewRef = useRef(null);
  const callbacks = useRef({ onChange, onRun, onValidate, onSave, onReady, onCursorChange });
  const replacing = useRef(false);
  callbacks.current = { onChange, onRun, onValidate, onSave, onReady, onCursorChange };

  useEffect(() => {
    function command(name) {
      return view => { callbacks.current[name]?.(view.state.doc.toString()); return true; };
    }
    const view = new EditorView({
      parent: mountRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), foldGutter(), drawSelection(), history(),
          indentOnInput(), indentUnit.of('  '), bracketMatching(), yaml(), syntaxHighlighting(yamlHighlight),
          keymap.of([
            { key: 'Mod-Enter', run: command('onRun') },
            { key: 'Mod-Shift-Enter', run: command('onValidate') },
            { key: 'Mod-s', run: command('onSave') },
            { key: 'Escape', run: temporarilySetTabFocusMode },
            ...defaultKeymap, ...historyKeymap, indentWithTab,
          ]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'Evaluation YAML', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false' }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !replacing.current) callbacks.current.onChange?.(update.state.doc.toString());
            if (update.selectionSet || update.docChanged) {
              const cursor = update.state.selection.main.head;
              const line = update.state.doc.lineAt(cursor);
              callbacks.current.onCursorChange?.({ line: line.number, column: cursor - line.from + 1 });
            }
          }),
          editorTheme,
        ],
      }),
    });
    viewRef.current = view;
    callbacks.current.onReady?.({
      focus: () => view.focus(),
      goToLine: (lineNumber, column = 1) => {
        const number = Number.isFinite(Number(lineNumber)) ? Number(lineNumber) : 1;
        const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, Math.floor(number))));
        const requestedColumn = Number.isFinite(Number(column)) ? Number(column) : 1;
        const position = line.from + Math.max(0, Math.min(line.length, Math.floor(requestedColumn) - 1));
        view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) });
        view.focus();
      },
    });
    return () => { callbacks.current.onReady?.(null); viewRef.current = null; view.destroy(); };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    replacing.current = true;
    try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } }); }
    finally { replacing.current = false; }
  }, [value]);

  return <div className="yaml-editor" ref={mountRef} />;
}
