/* file : xml-formatter.ts
MIT License

Copyright (c) 2018-2020 Thomas Minier

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

'use strict'

import Lodash from 'lodash'
const { isBoolean, isNull, isUndefined, map } = Lodash
import xml from 'xml'
import { PipelineStage } from '../engine/pipeline/pipeline-engine.js'
import { Pipeline } from '../engine/pipeline/pipeline.js'
import { Bindings } from '../rdf/bindings.js'
import { rdf } from '../utils/index.js'

type RDFBindings = { [key: string]: rdf.Term }

function _writeBoolean(input: boolean, root: xml.ElementObject) {
  root.push({ boolean: input })
}

function _writeBindings(input: Bindings, results: xml.ElementObject) {
  // convert sets of bindings into objects of RDF Terms
  const bindings: RDFBindings = input
    .filter((_variable, value) => !isNull(value) && !isUndefined(value))
    .reduce<RDFBindings>((obj, variable, value) => {
      obj[variable.value] = value
      return obj
    }, {})

  // Write the result tag for this set of bindings
  results.push({
    result: map(bindings, (value, variable) => {
      let xmlTag
      if (rdf.isNamedNode(value)) {
        xmlTag = { uri: value.value }
      } else if (rdf.isBlankNode(value)) {
        xmlTag = { bnode: value.value }
      } else if (rdf.isLiteral(value)) {
        if (value.language === '') {
          xmlTag = {
            literal: [{ _attr: { 'xml:lang': value.language } }, value.value],
          }
        } else {
          xmlTag = {
            literal: [
              { _attr: { datatype: value.datatype.value } },
              value.value,
            ],
          }
        }
      } else {
        throw new Error(`Unsupported RDF Term type: ${value}`)
      }
      return {
        binding: [{ _attr: { name: variable.substring(1) } }, xmlTag],
      }
    }),
  })
}

/**
 * Formats query solutions (bindings or booleans) from a PipelineStage in W3C SPARQL XML format
 * @see https://www.w3.org/TR/2013/REC-rdf-sparql-XMLres-20130321/
 * @author Thomas Minier
 * @author Corentin Marionneau
 * @param source - Input pipeline
 * @return A pipeline s-that yields results in W3C SPARQL XML format
 */
export default function xmlFormat(
  source: PipelineStage<Bindings | boolean>,
): PipelineStage<string> {
  const results = xml.element({})
  const root = xml.element({
    _attr: { xmlns: 'http://www.w3.org/2005/sparql-results#' },
    results: results,
  })
  const stream = xml(
    { sparql: root },
    { stream: true, indent: '\t' },
  ) as NodeJS.ReadableStream
  return Pipeline.getInstance().fromAsync((input) => {
    // manually pipe the xml stream's results into the pipeline
    stream.on('error', (err: Error) => input.error(err))
    stream.on('end', () => input.complete())

    let warmup = true
    source.subscribe(
      (b: Bindings | boolean) => {
        // Build the head attribute from the first set of bindings
        if (warmup && !isBoolean(b)) {
          const variables = Array.from(b.variables())
          root.push({
            head: variables
              .map((v) => v.value)
              .filter((name) => name !== '*')
              .map((name) => {
                return { variable: { _attr: { name } } }
              }),
          })
          warmup = false
        }
        // handle results (boolean for ASK queries, bindings for SELECT queries)
        if (isBoolean(b)) {
          _writeBoolean(b, root)
        } else {
          _writeBindings(b, results)
        }
      },
      (err) => console.error(err),
      () => {
        results.close()
        root.close()
      },
    )

    // consume the xml stream
    stream.on('data', (x: string) => input.next(x))
  })
}
