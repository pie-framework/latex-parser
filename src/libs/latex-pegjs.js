// This file needs to be here because typescript does not know how to use babel's transpiler
// to directly load Pegjs grammars.
import PegParser from "../PEG-grammar/latex.pegjs";

export default PegParser;