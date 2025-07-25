/* file : create-test.js
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

import { expect } from 'chai'
import { beforeEach, describe, it } from 'vitest'
import { rdf } from '../../src/utils'
import { N3Graph, TestEngine, getGraph } from '../utils.js'

const GRAPH_A_IRI = rdf.createIRI('http://example.org#some-graph-a')
const GRAPH_B_IRI = rdf.createIRI('http://example.org#some-graph-b')

describe('SPARQL UPDATE: CREATE queries', () => {
  let engine = null
  beforeEach(() => {
    const gA = getGraph('./tests/data/dblp.nt')
    engine = new TestEngine(gA, GRAPH_A_IRI)
    engine._dataset.setGraphFactory(() => new N3Graph())
  })

  const data = [
    {
      name: 'CREATE GRAPH',
      query: `CREATE GRAPH <${GRAPH_B_IRI.value}>`,
      testFun: () => {
        expect(engine.hasNamedGraph(GRAPH_B_IRI)).to.equal(true)
      },
    },
  ]

  data.forEach((d) => {
    it(`should evaluate "${d.name}" queries`, async () => {
      await engine
        .execute(d.query)
        .execute()
        .then(() => {
          d.testFun()
        })
    })
  })
})
