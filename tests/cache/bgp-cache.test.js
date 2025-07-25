/* file: bgp-cache-test.js
MIT License

Copyright (c) 2018-2020 Thomas Minier

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the 'Software'), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
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
import { BindingBase, rdf } from '../../src/api'
import { LRUBGPCache } from '../../src/engine/cache/bgp-cache'

/**
 * Format a BGP to the format expected by a BGPCache: an object
 * with fields 'patterns' and 'graphIRI'
 * @param {*} patterns - Set of triple patterns
 * @param {*} graphIRI - Graph's IRI
 */
function formatBGP(patterns, graphIRI) {
  return {
    patterns: patterns.map(formatPattern),
    graphIRI: rdf.createIRI(graphIRI),
  }
}

function formatPattern(pattern) {
  return {
    subject: rdf.fromN3(pattern.subject),
    predicate: rdf.fromN3(pattern.predicate),
    object: rdf.fromN3(pattern.object),
  }
}

describe('LRUBGPCache', () => {
  let cache = null
  beforeEach(() => {
    cache = new LRUBGPCache(100, 100)
  })

  describe('#update/commit', () => {
    it('should supports insertion of items over time', async () => {
      const writerID = 1
      const patterns = [
        { subject: '?s', predicate: 'rdf:type', object: '?type' },
      ]
      const bgp = formatBGP(patterns, 'http://example.org#graphA')
      const bindings = [
        BindingBase.fromObject({ '?s': ':s1', '?type': ':c1' }),
        BindingBase.fromObject({ '?s': ':s2', '?type': ':c2' }),
      ]
      cache.update(bgp, bindings[0], writerID)
      cache.update(bgp, bindings[1], writerID)
      cache.commit(bgp, writerID)
      const content = await cache.get(bgp)
      expect(content.map((x) => x.toObject())).to.deep.equals(
        bindings.map((x) => x.toObject()),
      )
    })
  })

  describe('#findSubset', () => {
    it('should find a subset for a Basic Graph Pattern which is partially in the cache', () => {
      // populate cache
      const subsetPatterns = [
        { subject: '?s', predicate: 'rdf:type', object: '?type' },
      ]
      const subsetBGP = formatBGP(subsetPatterns, 'http://example.org#graphA')
      cache.update(subsetBGP, BindingBase.fromObject({ '?s': ':s1' }), 1)
      cache.commit(subsetBGP, 1)
      // search for subset
      const patterns = [
        { subject: '?s', predicate: 'rdf:type', object: '?type' },
        { subject: '?s', predicate: 'foaf:name', object: '?name' },
      ]
      const bgp = formatBGP(patterns, 'http://example.org#graphA')
      const [computedSubset, computedMissing] = cache.findSubset(bgp)
      expect(computedSubset).to.deep.equals(subsetPatterns.map(formatPattern))
      expect(computedMissing).to.deep.equals([patterns[1]].map(formatPattern))
    })

    it('should find an empty subset for a Basic Graph Pattern with no valid subset in the cache', () => {
      // populate cache
      const subsetPatterns = [
        { subject: '?s', predicate: 'rdf:type', object: '?type' },
      ]
      const subsetBGP = formatBGP(subsetPatterns, 'http://example.org#graphA')
      cache.update(subsetBGP, BindingBase.fromObject({ '?s': ':s1' }), 1)
      cache.commit(subsetBGP, 1)
      // search for subset
      const patterns = [
        { subject: '?s', predicate: 'foaf:knows', object: '?type' },
        { subject: '?s', predicate: 'foaf:name', object: '?name' },
      ]
      const bgp = formatBGP(patterns, 'http://example.org#graphA')
      const [computedSubset, computedMissing] = cache.findSubset(bgp)
      expect(computedSubset.length).to.equals(0)
      expect(computedMissing).to.deep.equals(patterns.map(formatPattern))
    })

    it('should find the largest subset from the cache entry', () => {
      // populate cache
      const subsetPatterns_a = [
        { subject: '?s', predicate: 'rdf:type', object: '?type' },
      ]
      const subsetPatterns_b = [
        { subject: '?s', predicate: 'rdf:type', object: '?type' },
        { subject: '?s', predicate: 'foaf:name', object: '?name' },
      ]
      const subsetBGP_a = formatBGP(
        subsetPatterns_a,
        'http://example.org#graphA',
      )
      const subsetBGP_b = formatBGP(
        subsetPatterns_b,
        'http://example.org#graphA',
      )
      cache.update(subsetBGP_a, BindingBase.fromObject({ '?s': ':s1' }), 1)
      cache.commit(subsetBGP_a, 1)
      cache.update(subsetBGP_b, BindingBase.fromObject({ '?s': ':s2' }), 1)
      cache.commit(subsetBGP_b, 1)
      // search for subset
      const patterns = [
        { subject: '?s', predicate: 'rdf:type', object: '?type' },
        { subject: '?s', predicate: 'foaf:knows', object: '?type' },
        { subject: '?s', predicate: 'foaf:name', object: '?name' },
      ]
      const bgp = formatBGP(patterns, 'http://example.org#graphA')
      const [computedSubset, computedMissing] = cache.findSubset(bgp)
      expect(computedSubset).to.deep.equals(subsetPatterns_b.map(formatPattern))
      expect(computedMissing).to.deep.equals([patterns[1]].map(formatPattern))
    })
  })
})
