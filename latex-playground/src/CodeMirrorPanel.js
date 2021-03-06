/*
* Code forked from prettier https://github.com/prettier/prettier/blob/0f3967b5ab66f68b9b3c6a29eae5735140174ef3/website/playground/panels.js
*/
import CodeMirror from "codemirror";
import React from "react";

console.log("CMMM", CodeMirror)
window.CodeMirror = CodeMirror

export class CodeMirrorPanel extends React.Component {
    constructor() {
        super();
        this._textareaRef = React.createRef();
        this._codeMirror = null;
        this._cached = "";
        this._overlay = null;
        this.handleChange = this.handleChange.bind(this);
        this.handleFocus = this.handleFocus.bind(this);
    }

    componentDidMount() {
        const options = { ...this.props };
        delete options.ruler;
        delete options.rulerColor;
        delete options.value;
        delete options.onChange;

        options.rulers = [makeRuler(this.props)];

        if (options.foldGutter) {
            options.gutters = [
                "CodeMirror-linenumbers",
                "CodeMirror-foldgutter",
            ];
        }

        this._codeMirror = CodeMirror.fromTextArea(
            this._textareaRef.current,
            options
        );
        this._codeMirror.on("change", this.handleChange);
        this._codeMirror.on("focus", this.handleFocus);

        
//        window.CodeMirror.keyMap.pcSublime["Ctrl-L"] = false;
//        window.CodeMirror.keyMap.sublime["Ctrl-L"] = false;

        this.updateValue(this.props.value || "");
        this.updateOverlay();
    }

    componentWillUnmount() {
        this._codeMirror && this._codeMirror.toTextArea();
    }

    componentDidUpdate(prevProps) {
        if (this.props.value !== this._cached) {
            this.updateValue(this.props.value);
        }
        if (
            this.props.overlayStart !== prevProps.overlayStart ||
            this.props.overlayEnd !== prevProps.overlayEnd
        ) {
            this.updateOverlay();
        }
        if (this.props.mode !== prevProps.mode) {
            this._codeMirror.setOption("mode", this.props.mode);
        }
        if (this.props.ruler !== prevProps.ruler) {
            this._codeMirror.setOption("rulers", [makeRuler(this.props)]);
        }
    }

    updateValue(value) {
        this._cached = value;
        this._codeMirror.setValue(value);
    }

    updateOverlay() {
        if (!this.props.readOnly) {
            if (this._overlay) {
                this._codeMirror.removeOverlay(this._overlay);
            }
            const [start, end] = getIndexPosition(this.props.value, [
                this.props.overlayStart,
                this.props.overlayEnd,
            ]);
            this._overlay = createOverlay(start, end);
            this._codeMirror.addOverlay(this._overlay);
        }
    }

    handleFocus(/* codeMirror, event */) {
        if (this._codeMirror.getValue() === this.props.codeSample) {
            this._codeMirror.execCommand("selectAll");
        }
    }

    handleChange(doc, change) {
        if (change.origin !== "setValue") {
            this._cached = doc.getValue();
            this.props.onChange(this._cached);
            this.updateOverlay();
        }
    }

    render() {
        return (
            <div className="editor input">
                <textarea ref={this._textareaRef} />
            </div>
        );
    }
}

function getIndexPosition(text, indexes) {
    indexes = indexes.slice();
    let line = 0;
    let count = 0;
    let lineStart = 0;
    const result = [];

    while (indexes.length) {
        const index = indexes.shift();

        while (count < index && count < text.length) {
            if (text[count] === "\n") {
                line++;
                lineStart = count;
            }
            count++;
        }

        result.push({ line, pos: count - lineStart });
    }

    return result;
}

function createOverlay(start, end) {
    return {
        token(stream) {
            const { line } = stream.lineOracle;

            if (line < start.line || line > end.line) {
                stream.skipToEnd();
            } else if (line === start.line && stream.pos < start.pos) {
                stream.pos = start.pos;
            } else if (line === end.line) {
                if (stream.pos < end.pos) {
                    stream.pos = end.pos;
                    return "searching";
                }
                stream.skipToEnd();
            } else {
                stream.skipToEnd();
                return "searching";
            }
        },
    };
}

function makeRuler(props) {
    return { column: props.ruler, color: props.rulerColor };
}

export function InputPanel(props) {
    return (
        <CodeMirrorPanel
            lineNumbers={true}
            keyMap="sublime"
            autoCloseBrackets={true}
            matchBrackets={true}
            showCursorWhenSelecting={true}
            tabSize={4}
            rulerColor="#eeeeee"
            {...props}
        />
    );
}

export function OutputPanel(props) {
    return (
        <CodeMirrorPanel
            readOnly={true}
            lineNumbers={true}
            rulerColor="#444444"
            {...props}
        />
    );
}

export function DebugPanel({ value }) {
    return (
        <CodeMirrorPanel
            readOnly={true}
            lineNumbers={false}
            foldGutter={true}
            mode="jsx"
            value={value}
        />
    );
}
