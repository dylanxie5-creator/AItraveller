import {archivePdfFilename} from '../archive/pdf-runtime.mjs';
import {createTripArchivePdf} from '../archive/trip-pdf.mjs';
import {createTravelArchivePdf} from '../archive/travel-archive-pdf.mjs';

export function createArchivePdfService({archives,tripRenderer=createTripArchivePdf,travelRenderer=createTravelArchivePdf}={}) {
  if(typeof archives?.getTripArchive!=='function'||typeof archives?.getTravelArchive!=='function'||typeof tripRenderer!=='function'||typeof travelRenderer!=='function')throw new TypeError('PDF 档案服务配置无效');
  return {
    async getTripPdf(id) {const report=archives.getTripArchive(id),body=await tripRenderer(report);return {filename:archivePdfFilename(report),body};},
    async getTravelPdf() {const report=archives.getTravelArchive(),body=await travelRenderer(report);return {filename:archivePdfFilename(report),body};},
  };
}
