import Prettier from "prettier/standalone";
import { parse, printRaw } from "./libs/parser";
import { ReferenceMap, hasPreambleCode, trim } from "./libs/macro-utils";
import { parseAlignEnvironment } from "./libs/align-environment-parser";

const ESCAPE = "\\";

// Commands to build the prettier syntax tree
const {
    concat,
    //group,
    fill,
    //ifBreak,
    line,
    softline,
    hardline,
    //lineSuffix,
    //lineSuffixBoundary,
    indent,
    //markAsRoot,
} = Prettier.doc.builders;

/**
 * Join an array with `softline`. However, if a `line` is
 * found, do not insert an additional softline. For example
 * `[a, b, c]` -> `[a, softline, b, softline, c]`
 *
 * but
 *
 * `[a, line, b, c]` -> `[a, line, b, softline, c]`
 *
 * @param {*} arr
 * @returns
 */
function joinWithSoftline(arr) {
    if (arr.length === 0 || arr.length === 1) {
        return arr;
    }
    const ret = [arr[0]];
    for (let i = 1; i < arr.length; i++) {
        const prevNode = arr[i - 1];
        const nextNode = arr[i];
        if (nextNode.type !== "line" && prevNode.type !== "line") {
            ret.push(softline);
        }
        ret.push(nextNode);
    }
    return ret;
}

/**
 * Formats the content of an aligned/tabular environment's content.
 * Ensures the "&" delimiters all line up.
 *
 * @export
 * @param {[object]} nodes
 * @returns {{rows: [string], rowSeps: [object]}}
 */
export function formatAlignedContent(nodes) {
    function getSpace(len = 1) {
        return " ".repeat(len);
    }

    const rows = parseAlignEnvironment(nodes);
    // Find the number of columns
    const numCols = Math.max(...rows.map((r) => r.cells.length));
    const rowSeps = rows.map(({ rowSep }) => printRaw(rowSep || []));
    const trailingComments = rows.map(({ trailingComment }) => trailingComment);

    // Get the widths of each column.
    // Column widths will be the width of column contents plus the width
    // of the separator. This way, even multi-character separators
    // can be accommodated when rendering.
    const renderedRows = rows.map(({ cells, colSeps }) => ({
        cells: cells.map(trim).map(printRaw),
        seps: colSeps.map(printRaw),
    }));
    const colWidths = [];
    for (let i = 0; i < numCols; i++) {
        colWidths.push(
            Math.max(
                ...renderedRows.map(
                    ({ cells, seps }) =>
                        ((cells[i] || "") + (seps[i] || "")).length
                )
            )
        );
    }

    const joinedRows = renderedRows.map(({ cells, seps }) => {
        if (cells.length === 1 && cells[0] === "") {
            return "";
        }
        let ret = "";
        for (let i = 0; i < cells.length; i++) {
            // There are at least as many cells as there are `seps`. Possibly one extra
            const width = colWidths[i] - (seps[i] || "").length;

            // Insert a space at the start so we don't run into the prior separator.
            // We'll trim this off in the end, in case it's not needed.
            ret +=
                (i === 0 ? "" : " ") +
                cells[i] +
                getSpace(width - cells[i].length + 1) +
                (seps[i] || "");
        }
        return ret;
    });

    return { rows: joinedRows, rowSeps, trailingComments };
}

/**
 * Print a `.type === environment` node.
 *
 * @param {*} path
 * @param {function} print
 * @returns
 */
function printEnvironmentContent(path, print, mode) {
    const node = path.getValue();

    if (mode === "aligned") {
        // If an aligned environment starts with a same-line comment, we want
        // to ignore it. It will be printed by the environment itself.
        const leadingComment =
            node.content[0] &&
            node.content[0].type === "comment" &&
            node.content[0].sameline
                ? node.content[0]
                : null;

        const { rows, rowSeps, trailingComments } = formatAlignedContent(
            leadingComment ? node.content.slice(1) : node.content
        );

        const content = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowSep = rowSeps[i];
            const trailingComment = trailingComments[i];

            // A row has
            // 1) Content
            // 2) (optional) rowSep (e.g., `\\`)
            // 3) (optional) comment
            // We want there to be exactly one space before the rowsep and exactly one space
            // before any comment.
            content.push(row);
            if (rowSep) {
                content.push(printRaw(rowSep));
            }
            if (rowSep && trailingComment) {
                content.push(" ");
            }
            if (trailingComment) {
                content.push(concat(["%", printRaw(trailingComment.content)]));
            }
            if (rowSep || trailingComment) {
                content.push(hardline);
            }
        }
        // Make sure the last item is not a `hardline`.
        if (content[content.length - 1] === hardline) {
            content.pop();
        }

        if (leadingComment) {
            content.unshift("%" + printRaw(leadingComment.content), hardline);
        }

        return concat(content);
    }

    // By default, we just render the content
    return path.call(print, "content");
}

/**
 * Print a `.type === macro` node. `mode` can be
 *  - `"tree"` - print the argument hierarchically (with content nested between open marks and closed marks) and return a prettier object.
 *  - `"flat"` - print as a flat list (not wrapped in a prettier object)
 *
 * @param {*} path
 * @param {function} print
 * @param {string} [mode="tree"]
 * @returns
 */
function printMacro(path, print, mode = "tree") {
    const node = path.getValue();
    const renderInfo = node._renderInfo || {};

    let args = [];
    if (node.args != null) {
        // If the macro has been marked as inParMode,
        // it should render inline as if it is part of regular text.
        // To do this, we print the arguments and extract the contents.
        if (renderInfo.inParMode) {
            // gather all the args flat-printed
            args = path.map(
                (subPath) => printArgument(subPath, print, "flat"),
                "args"
            );
        } else {
            args = path.map(print, "args");
        }
    }
    // An array with all the prettier commands to be rendered by a `fill` or `concat`
    const escape = node.escapeToken == null ? ESCAPE : node.escapeToken;
    const flatBody = [].concat([escape, printRaw(node.content)], ...args);

    if (mode === "tree") {
        if (renderInfo.hangingIndent) {
            return indent(concat(flatBody));
        }
        return concat(flatBody);
    }
    if (mode === "flat") {
        return flatBody;
    }
}

/**
 * Print a `.type === arguments` node. `mode` can be
 *  - `"tree"` - print the argument hierarchically (with content nested between open marks and closed marks) and return a prettier object.
 *  - `"flat"` - print as a flat list (not wrapped in a prettier object)
 *
 * @param {*} path
 * @param {function} print
 * @param {string} [mode="tree"]
 * @returns
 */
function printArgument(path, print, mode = "tree") {
    const node = path.getValue();
    if (mode === "tree") {
        return concat([
            node.openMark,
            path.call(print, "content"),
            node.closeMark,
        ]);
    }
    if (mode === "flat") {
        return [].concat(
            node.openMark,
            path.map(print, "content"),
            node.closeMark
        );
    }
}

/**
 * Computes the environment name, start/end, and args.
 * E.g., for "\begin{x}abc\end{x}", it returns
 * ```
 * {
 *  envName: "x",
 *  start: "\\begin{x}",
 *  end: "\\end{x}",
 *  args: ""
 * }
 * ```
 *
 * @param {*} node
 * @returns
 */
function formatEnvSurround(node) {
    const env = printRaw(node.env);

    return {
        envName: env,
        start: ESCAPE + "begin{" + env + "}",
        end: ESCAPE + "end{" + env + "}",
        args: node.args == null ? "" : printRaw(node.args),
    };
}

const EMPTY_OBJECT = {};

function printLatexAst(path, options, print) {
    const node = path.getValue();
    let renderInfo = node._renderInfo || EMPTY_OBJECT;
    const previousNode =
        (options.referenceMap && options.referenceMap.getPreviousNode(node)) ||
        EMPTY_OBJECT;
    const nextNode =
        (options.referenceMap && options.referenceMap.getNextNode(node)) ||
        EMPTY_OBJECT;
    // It's useful to know whether we're the start or end node in an array,
    // so compute this information.
    renderInfo = {
        ...renderInfo,
        endNode: nextNode === EMPTY_OBJECT,
        startNode: previousNode === EMPTY_OBJECT,
    };

    let breakOnAllLines = false;
    if (path.getName() == null) {
        // We're at the root, so make a map of the ast so that we can
        // "peek" to find previous and next siblings during rendering
        options.referenceMap = new ReferenceMap(node);

        if (Array.isArray(node) && hasPreambleCode(node)) {
            // If we are rendering the preamble, we want to put newlines instead
            // of spaces.
            breakOnAllLines = true;
        }
    }

    if (node == null) {
        return node;
    }
    if (typeof node === "string") {
        return node;
    }
    if (Array.isArray(node)) {
        // If we are directly handed an array to print, we assume it should
        // be printed in paragraph mode. Therefore we should request the "flat"
        // versions of certain node types so they can all be rendered in the
        // same `fill`.
        const printFlatVersion = (subPath) => {
            const node = subPath.getValue();
            const renderInfo = node._renderInfo || {};

            if (node.type === "macro") {
                const content = [].concat(...printMacro(path, print, "flat"));
                if (renderInfo.hangingIndent) {
                    return indent(fill(content));
                }
            }
            return print(subPath);
        };
        let content = null;
        if (options.inMathMode) {
            // In math mode, whitespace is completely ignored, so we may wrap at any time
            content = joinWithSoftline(path.map(printFlatVersion));
        } else {
            content = path.map(printFlatVersion);
        }

        const formatFunc = breakOnAllLines ? concat : fill;

        return formatFunc([].concat(...content));
    }

    // tmp variables
    let content, startToken, bodyStartToken, env;
    switch (node.type) {
        case "argument":
            return printArgument(path, print, "tree");
        case "comment":
            content = ["%" + printRaw(node.content)];
            if (node.sameline) {
                // This used to be a `lineSuffix` with a `lineSuffixBoundary`, but that turned out
                // not to work because a `lineSuffix` is never printed if a line is never encountered
                // (e.g., if a file ends with a comment). Since comment position is important in LaTeX
                // documents (since whitespace is significant), we enforce a printing style where
                // comments are always flushed, right where they are
                if (!node.suffixParbreak && !renderInfo.endNode) {
                    content.push(hardline);
                }
                return concat(content);
            }
            // Comments should insert a prefix and suffix newline unless
            // they start/end an environment or they come right after another
            // comment.
            if (!renderInfo.startNode && previousNode.type !== "comment") {
                content.unshift(hardline);
            }
            if (!node.suffixParbreak && !renderInfo.endNode) {
                content.push(hardline);
            }
            return concat(content);
        case "environment":
        case "mathenv":
        case "verbatim":
            env = formatEnvSurround(node);

            var mode = "";
            if (renderInfo.alignContent) {
                mode = "aligned";
            }
            if (renderInfo.inMathMode != null) {
                // The environment might switch modes if an `inMathMode` property is supplied
                const prevMathMode = options.inMathMode;
                options.inMathMode = renderInfo.inMathMode;
                content = printEnvironmentContent(path, print, mode);
                options.inMathMode = prevMathMode;
            } else {
                content = printEnvironmentContent(path, print, mode);
            }
            // If we are a startNode or we are preceded by a parskip,
            // we don't want a forced newline at the start.
            startToken = [hardline];
            if (
                renderInfo.startNode ||
                previousNode.type === "parbreak" ||
                previousNode.type === "comment"
            ) {
                startToken = [];
            }

            // If we start with a comment on the same line as the environment
            // We should not insert a newline at the start of the environment body
            bodyStartToken = [hardline];
            if (
                node.content.length === 0 ||
                (node.content[0].type === "comment" && node.content[0].sameline)
            ) {
                bodyStartToken.pop();
                // If there is leading whitespace before the sameline comment,
                // we do want to preserve that.
                if (
                    node.content.length > 0 &&
                    node.content[0].leadingWhitespace
                ) {
                    bodyStartToken.push(" ");
                }
            }

            // Verbatim environments should be printed with their content
            // directly included instead of indented/etc.
            if (node.type === "verbatim") {
                return concat(
                    startToken.concat([env.start, env.args, content, env.end])
                );
            }

            return concat(
                startToken.concat([
                    env.start,
                    env.args,
                    indent(concat(bodyStartToken.concat([content]))),
                    hardline,
                    env.end,
                ])
            );

        case "displaymath":
            // use the `options` object to pass information about the current state
            // to the recursive call to `print`.
            options.inMathMode = true;
            content = path.call(print, "content");
            options.inMathMode = false;

            // If we are a startNode or we are preceded by a parskip,
            // we don't want a forced newline at the start.
            startToken = [hardline];
            if (
                renderInfo.startNode ||
                previousNode.type === "parbreak" ||
                previousNode.type === "comment"
            ) {
                startToken = [];
            }

            // If we start with a comment on the same line as the environment
            // We should not insert a newline at the start of the environment body
            bodyStartToken = [hardline];
            if (
                node.content.length === 0 ||
                (node.content[0].type === "comment" && node.content[0].sameline)
            ) {
                bodyStartToken.pop();
            }

            return concat(
                startToken.concat([
                    ESCAPE + "[",
                    indent(concat(bodyStartToken.concat([content]))),
                    hardline,
                    ESCAPE + "]",
                ])
            );
        case "group":
            return concat(["{", printRaw(node.content), "}"]);
        case "inlinemath":
            // Since `$$` starts display math mode (in plain TeX),
            // an empty inline math environment must be printed as `$ $`.
            // We special case this.
            if (node.content.length === 0) {
                // We won't allow an empty math environment to be broken
                return concat(["$", " ", "$"]);
            }

            options.inMathMode = true;
            content = path.call(print, "content");
            options.inMathMode = false;

            // If the last node is a comment, we need a linebreak before the closing `$`
            if (node.content[node.content.length - 1].type === "comment") {
                content = concat([content, hardline]);
            }

            return concat(["$", content, "$"]);
        case "macro":
            if (renderInfo.inParMode && !renderInfo.hangingIndent) {
                return printMacro(path, print, "flat");
            }
            return printMacro(path, print, "tree");
        case "parbreak":
            return concat([hardline, hardline]);
        case "string":
            return node.content;
        case "verb":
            return concat([
                ESCAPE,
                node.env,
                node.escape,
                printRaw(node.content),
                node.escape,
            ]);
        case "whitespace":
            // Environments print a `hardline` before they start, so there is no need to
            // put any whitespace down if the next item is an environment
            if (
                (nextNode.env != null && nextNode.type !== "verb") ||
                nextNode.type === "displaymath"
            ) {
                return "";
            }

            // Most of the time we print in `fill` mode, which means
            // a `line` is either a line break or a space. However, if the
            // previous node is an environment, we want to use a `hardline` instead
            // of a line.
            if (
                (previousNode.env != null && previousNode.type !== "verb") ||
                previousNode.type === "displaymath"
            ) {
                return hardline;
            }

            return line;
        default:
            console.warn("Printing unknown type", node);
            return printRaw(node);
    }
}

export const languages = [
    {
        name: "latex",
        extensions: [".tex"],
        parsers: ["latex-parser"],
    },
];

export const parsers = {
    "latex-parser": {
        parse,
        astFormat: "latex-ast",
        locStart: (node) => node.loc ? node.loc.start.offset: 0,
        locEnd: (node) => node.loc ? node.loc.end.offset: 1,
    },
};

export const printers = {
    "latex-ast": {
        print: printLatexAst,
    },
};
