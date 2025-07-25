/* file : utils.js
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

import fs from 'fs'
import Lodash from 'lodash'
const { isArray, pick } = Lodash
import { Parser, Store } from 'n3'
import { Graph, HashMapDataset, Pipeline, PlanBuilder, rdf } from '../src/api'

export function getGraph(filePaths, isUnion = false) {
  let graph
  if (isUnion) {
    graph = new UnionN3Graph()
  } else {
    graph = new N3Graph()
  }
  if (typeof filePaths === 'string') {
    graph.parse(filePaths)
  } else if (isArray(filePaths)) {
    filePaths.forEach((filePath) => graph.parse(filePath))
  }
  return graph
}

function formatTriplePattern(triple) {
  let subject = null
  let predicate = null
  let object = null
  if (!rdf.isVariable(triple.subject)) {
    subject = triple.subject
  }
  if (!rdf.isVariable(triple.predicate)) {
    predicate = triple.predicate
  }
  if (!rdf.isVariable(triple.object)) {
    object = triple.object
  }
  return { subject, predicate, object }
}

export class N3Graph extends Graph {
  constructor() {
    super()
    this._store = new Store()
    this._parser = new Parser()
  }

  parse(file) {
    const content = fs.readFileSync(file).toString('utf-8')
    this._parser.parse(content).forEach((t) => {
      this._store.addQuad(t)
    })
  }

  insert(triple) {
    return new Promise((resolve, reject) => {
      try {
        this._store.addQuad(triple.subject, triple.predicate, triple.object)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  }

  delete(triple) {
    return new Promise((resolve, reject) => {
      try {
        this._store.removeQuad(triple.subject, triple.predicate, triple.object)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  }

  find(triple) {
    const { subject, predicate, object } = formatTriplePattern(triple)
    return this._store.getQuads(subject, predicate, object).map((t) => {
      return pick(t, ['subject', 'predicate', 'object'])
    })
  }

  estimateCardinality(triple) {
    const { subject, predicate, object } = formatTriplePattern(triple)
    return Promise.resolve(this._store.countQuads(subject, predicate, object))
  }

  clear() {
    const triples = this._store.getQuads(null, null, null)
    this._store.removeQuads(triples)
    return Promise.resolve()
  }
}

class UnionN3Graph extends N3Graph {
  constructor() {
    super()
  }

  evalUnion(patterns, context) {
    return Pipeline.getInstance().merge(
      ...patterns.map((pattern) => this.evalBGP(pattern, context)),
    )
  }
}

export class TestEngine {
  constructor(graph, defaultGraphIRI = null, customOperations = {}) {
    this._graph = graph
    this._defaultGraphIRI =
      defaultGraphIRI === null ? this._graph.iri : defaultGraphIRI
    this._dataset = new HashMapDataset(this._defaultGraphIRI, this._graph)
    this._builder = new PlanBuilder(this._dataset, {}, customOperations)
  }

  defaultGraphIRI() {
    return this._dataset.getDefaultGraph().iri
  }

  addNamedGraph(iri, db) {
    this._dataset.addNamedGraph(iri, db)
  }

  getNamedGraph(iri) {
    return this._dataset.getNamedGraph(iri)
  }

  hasNamedGraph(iri) {
    return this._dataset.hasNamedGraph(iri)
  }

  execute(query) {
    let iterator = this._builder.build(query)
    return iterator
  }
}
