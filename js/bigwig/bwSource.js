/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Broad Institute
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * Created by jrobinso on 4/7/14.
 */


var igv = (function (igv) {

    igv.BWSource = function (config) {

        this.reader = new igv.BWReader(config);
        this.bufferedReader = new igv.BufferedReader(config);
    };

    igv.BWSource.prototype.getFeatures = function (chr, bpStart, bpEnd, bpPerPixel) {

        var self = this,
            decodeFunction,
            bufferedReader,
            chrIdx,
            featureCache = self.featureCache,
            genomicInterval = new igv.GenomicInterval(chr, bpStart, bpEnd);

        genomicInterval.bpPerPixel = bpPerPixel;

        if (featureCache && featureCache.range.bpPerPixel === bpPerPixel && featureCache.range.containsRange(genomicInterval)) {
            return Promise.resolve(self.featureCache.queryFeatures(chr, bpStart, bpEnd));
        }
        else {
            bufferedReader = self.bufferedReader;

            return self.reader.getZoomHeaders()

                .then(function (zoomLevelHeaders) {

                    // Select a biwig "zoom level" appropriate for the current resolution
                    var bwReader = self.reader,
                        zoomLevelHeader = zoomLevelForScale(bpPerPixel, zoomLevelHeaders),
                        treeOffset;

                    if (zoomLevelHeader) {
                        treeOffset = zoomLevelHeader.indexOffset;
                        decodeFunction = decodeZoomData;
                    } else {
                        treeOffset = bwReader.header.fullIndexOffset;
                        if (bwReader.type === "BigWig") {
                            decodeFunction = decodeWigData;
                        }
                        else {
                            decodeFunction = decodeBedData;
                        }
                    }

                    return self.reader.loadRPTree(treeOffset);
                })

                .then(function (rpTree) {

                    chrIdx = self.reader.chromTree.dictionary[chr];
                    if (chrIdx === undefined) {
                        return undefined;
                    }
                    else {
                        return rpTree.findLeafItemsOverlapping(chrIdx, bpStart, bpEnd)
                    }
                })

                .then(function (leafItems) {

                    var promises = [];

                    if (!leafItems || leafItems.length == 0) {
                        return [];
                    }
                    else {
                        leafItems.forEach(function (item) {

                            promises.push(
                                bufferedReader.dataViewForRange({
                                    start: item.dataOffset,
                                    size: item.dataSize
                                }, true)
                                    .then(function (uint8Array) {
                                        var features = [];
                                        var inflate = new Zlib.Inflate(uint8Array);
                                        var plain = inflate.decompress();
                                        decodeFunction(new DataView(plain.buffer), chr, chrIdx, bpStart, bpEnd, features);
                                        return features;
                                    })
                            )
                        });

                        return Promise.all(promises);
                    }
                })

                .then(function (featureArrays) {

                    var i, allFeatures = [];

                    for (i = 0; i < featureArrays.length; i++) {
                        allFeatures = allFeatures.concat(featureArrays[i]);
                    }

                    allFeatures.sort(function (a, b) {
                        return a.start - b.start;
                    })
                    
                    // Note -- replacing feature cache
                    self.featureCache = new igv.FeatureCache(allFeatures, genomicInterval);

                    return allFeatures;
                })
        }
    }


    igv.BWSource.prototype.getDefaultRange = function () {

        if (this.reader.totalSummary != undefined) {
            return this.reader.totalSummary.defaultRange;
        }
        else {
            return undefined;
        }

    }


    function zoomLevelForScale(bpPerPixel, zoomLevelHeaders) {

        var level = null, i, zl;

        for (i = 0; i < zoomLevelHeaders.length; i++) {

            zl = zoomLevelHeaders[i];

            if (zl.reductionLevel < bpPerPixel) {
                level = zl;
                break;
            }
        }

        return level;
    }

    function decodeWigData(data, chr, chrIdx, bpStart, bpEnd, featureArray) {

        var binaryParser = new igv.BinaryParser(data),
            chromId = binaryParser.getInt(),
            chromStart = binaryParser.getInt(),
            chromEnd = binaryParser.getInt(),
            itemStep = binaryParser.getInt(),
            itemSpan = binaryParser.getInt(),
            type = binaryParser.getByte(),
            reserved = binaryParser.getByte(),
            itemCount = binaryParser.getUShort(),
            value;

        if (chromId === chrIdx) {

            while (itemCount-- > 0) {

                switch (type) {
                    case 1:
                        chromStart = binaryParser.getInt();
                        chromEnd = binaryParser.getInt();
                        value = binaryParser.getFloat();
                        break;
                    case 2:
                        chromStart = binaryParser.getInt();
                        value = binaryParser.getFloat();
                        chromEnd = chromStart + itemSpan;
                        break;
                    case 3:  // Fixed step
                        value = binaryParser.getFloat();
                        chromEnd = chromStart + itemSpan;
                        chromStart += itemStep;
                        break;

                }

                if (chromStart >= bpEnd) {
                    break; // Out of interval
                } else if (chromEnd > bpStart && Number.isFinite(value)) {
                    featureArray.push({chr: chr, start: chromStart, end: chromEnd, value: value});
                }


            }
        }

    }

    function decodeZoomData(data, chr, chrIdx, bpStart, bpEnd, featureArray) {

        var binaryParser = new igv.BinaryParser(data),
            minSize = 8 * 4,   // Minimum # of bytes required for a zoom record
            chromId,
            chromStart,
            chromEnd,
            validCount,
            minVal,
            maxVal,
            sumData,
            sumSquares,
            value;

        while (binaryParser.remLength() >= minSize) {
            chromId = binaryParser.getInt();
            if (chromId === chrIdx) {

                chromStart = binaryParser.getInt();
                chromEnd = binaryParser.getInt();
                validCount = binaryParser.getInt();
                minVal = binaryParser.getFloat();
                maxVal = binaryParser.getFloat();
                sumData = binaryParser.getFloat();
                sumSquares = binaryParser.getFloat();
                value = validCount == 0 ? 0 : sumData / validCount;

                if (chromStart >= bpEnd) {
                    break; // Out of interval

                } else if (chromEnd > bpStart && Number.isFinite(value)) {
                    featureArray.push({chr: chr, start: chromStart, end: chromEnd, value: value});
                }

            }
        }

    }

    function decodeBedData(data, chr, chrIdx, bpStart, bpEnd, featureArray) {

        var binaryParser = new igv.BinaryParser(data),
            minSize = 3 * 4 + 1,   // Minimum # of bytes required for a bed record
            chromId,
            chromStart,
            chromEnd,
            rest,
            tokens,
            feature,
            exonCount, exonSizes, exonStarts, exons, eStart, eEnd;


        while (binaryParser.remLength() >= minSize) {

            chromId = binaryParser.getInt();
            if (chromId != chrIdx) continue;

            chromStart = binaryParser.getInt();
            chromEnd = binaryParser.getInt();
            rest = binaryParser.getString();

            feature = {chr: chr, start: chromStart, end: chromEnd};

            if (chromStart < bpEnd && chromEnd >= bpStart) {
                featureArray.push(feature);

                tokens = rest.split("\t");

                if (tokens.length > 0) {
                    feature.name = tokens[0];
                }

                if (tokens.length > 1) {
                    feature.score = parseFloat(tokens[1]);
                }
                if (tokens.length > 2) {
                    feature.strand = tokens[2];
                }
                if (tokens.length > 3) {
                    feature.cdStart = parseInt(tokens[3]);
                }
                if (tokens.length > 4) {
                    feature.cdEnd = parseInt(tokens[4]);
                }
                if (tokens.length > 5) {
                    if (tokens[5] !== "." && tokens[5] !== "0")
                        feature.color = igv.createColorString(tokens[5]);
                }
                if (tokens.length > 8) {
                    exonCount = parseInt(tokens[6]);
                    exonSizes = tokens[7].split(',');
                    exonStarts = tokens[8].split(',');
                    exons = [];

                    for (var i = 0; i < exonCount; i++) {
                        eStart = start + parseInt(exonStarts[i]);
                        eEnd = eStart + parseInt(exonSizes[i]);
                        exons.push({start: eStart, end: eEnd});
                    }

                    feature.exons = exons;
                }
            }
        }

    }


    return igv;


})
(igv || {});
