/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2016 University of California San Diego
 * Author: Jim Robinson
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

import { DOMUtils, Icon, StringUtils } from '../../node_modules/igv-utils/src/index.js'

const sliderMin = 0
let sliderMax = 23
let sliderValueRaw = 0

const ZoomWidget = function (browser, parent) {

    this.browser = browser

    this.zoomContainer = DOMUtils.div({ class: 'igv-zoom-widget' })
    parent.appendChild(this.zoomContainer)

    // zoom out
    let el = DOMUtils.div()
    this.zoomContainer.appendChild(el)
    el.appendChild(Icon.createIcon('minus-circle'))
    el.addEventListener('click', () => {
        browser.zoomWithScaleFactor(2.0)
    })

    // Range slider
    el = DOMUtils.div()
    this.zoomContainer.appendChild(el)
    this.slider = document.createElement('input')
    this.slider.type = 'range'

    this.slider.min = `${ sliderMin }`
    this.slider.max = `${ sliderMax }`

    el.appendChild(this.slider)

    this.slider.addEventListener('change', e => {

        const referenceFrame = browser.referenceFrameList[ 0 ]
        const { bpLength } = referenceFrame.genome.getChromosome(referenceFrame.chr)
        const { initialEnd:end, start } = referenceFrame

        const extent = end - start

        // bpLength/(end - start)
        const scaleFactor = Math.pow(2, e.target.valueAsNumber)

        // (end - start) = bpLength/scaleFactor
        const zoomedExtent = bpLength/scaleFactor

        console.log(`zoom-widget - slider ${ e.target.value } scaleFactor ${ scaleFactor } extent-zoomed ${ StringUtils.numberFormatter(Math.round(zoomedExtent)) }`)

        browser.zoomWithScaleFactor(zoomedExtent/extent)

    })

    // zoom in
    el = DOMUtils.div()
    this.zoomContainer.appendChild(el)
    el.appendChild(Icon.createIcon('plus-circle'))
    el.addEventListener('click', () => {
        browser.zoomWithScaleFactor(0.5)
    })

    browser.on('locuschange', (referenceFrame) => {
        this.update(referenceFrame)
    })

};

ZoomWidget.prototype.update = function (referenceFrame) {

    const { bpLength } = referenceFrame.genome.getChromosome(referenceFrame.chr)
    const { start, initialEnd: end } = referenceFrame

    sliderMax = Math.ceil(Math.log2(bpLength/this.browser.minimumBases()))

    this.slider.max = `${ sliderMax }`

    const scaleFactor = bpLength/(end-start)
    sliderValueRaw = Math.log2(scaleFactor)
    this.slider.value = `${ Math.round(sliderValueRaw) }`

    const extent = end - start

    const derivedScalefactor = Math.pow(2, sliderValueRaw)

    const derivedExtent = bpLength/derivedScalefactor

    // console.log(`frame - start ${ StringUtils.numberFormatter(Math.floor(start)) } end ${ StringUtils.numberFormatter(Math.floor(end)) } extent ${ StringUtils.numberFormatter(Math.floor(extent)) }`)

    console.log(`${ Date.now() } update - slider ${ this.slider.value } scaleFactor ${ Math.round(scaleFactor) } extent ${ StringUtils.numberFormatter(Math.round(extent)) }`)

    // console.log(`update - sliderMin ${ sliderMin } sliderValue ${ this.slider.value } sliderMax ${ sliderMax } scaleFactor ${ scaleFactor.toFixed(3) } derived-scaleFactor ${ derivedScalefactor.toFixed(3) }`)

}

ZoomWidget.prototype.enable = function () {
    // enable
    this.slider.disabled = false;
};

ZoomWidget.prototype.disable = function () {
    // disable
    this.slider.disabled = true;
};

ZoomWidget.prototype.hide = function () {
    this.zoomContainer.style.display = 'none'
};

ZoomWidget.prototype.show = function () {
    this.zoomContainer.style.display = 'block'
};

ZoomWidget.prototype.hideSlider = function () {
    this.slider.style.display = 'none'
};

ZoomWidget.prototype.showSlider = function () {
    this.slider.style.display = 'block'
};

function lerpAlvyRaySmith(a, b, t) {
    return a - t * (a - b)
}

export default ZoomWidget;
